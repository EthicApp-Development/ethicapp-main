from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
import os
import requests
from flask_migrate import Migrate
from celery import Celery, chain
from text_analysis import score_words, texts_to_embeddings, topics, cosine_similarity
from use_language_model import USELanguageModel
from celery import chord
from kombu import Queue, Exchange
from celery.signals import task_revoked
import math
import redis
import hashlib
from pypdf import PdfReader
from io import BytesIO
from stop_words import stop_words

models = {'use': USELanguageModel()}

app = Flask(__name__)
app.config.from_object(os.getenv('APP_SETTINGS',"config.DevelopmentConfig"))
db = SQLAlchemy(app)
migrate = Migrate(app, db, compare_type=True)
#from models import Comments, Process, Topics

validation_api_key = os.environ.get("ETHICAPP_API_KEY")
redis_host_name = os.environ.get("REDIS_HOST_NAME")
if not redis_host_name:
    redis_host_name = 'localhost' 
    
celery = Celery('tasks',
    broker=f'redis://{redis_host_name}:6379/0',
    backend=f'redis://{redis_host_name}:6379/0',
    include=['app','celery'])

celery.conf.task_queues = [
    Queue('celery', routing_key='celery', max_length=1, exchange=Exchange('celery')),
    Queue('emb', routing_key='emb', max_length=1, exchange=Exchange('emb'))
]

celery.conf.task_routes = {'celery.get-top-worst-comments': {'queue': 'celery'}, 'celery.client_callback': {'queue': 'celery'}}
celery.autodiscover_tasks(['celery.get-top-worst-comments'], force=True)
celery.autodiscover_tasks(['celery.client_callback'], force=True)

r = redis.Redis(host=f'{redis_host_name}', port=6379, decode_responses=True)

def task_chain(params,model):
    res = chain(get_top_worst_comments.s(params, model), client_callback.s()).apply_async()

@app.route('/top-worst', methods=['POST'])
def top_worst_embeddings():
    params = request.get_json()
    model = 'use'
    
    task_chain(params, model)
    
    return params, 200

def get_finalist_amount_from(comments_amount):
    '''
    Get amount of finalist comments.

    This number of comments will be the one that will be selected based on the 
    cosine similarity between the comment and the question.

    Args:
        comments_amount (int): Number of comments received.
    
    Returns:
        int: Number of comments that will be finalists.
    '''
    # return math.ceil(comments_amount / 4)
    return math.ceil(comments_amount / 2)

def get_winners_amount_from(finalists_amount):
    '''
    Get amount of winners comments.

    This number of comments will be the one that will be selected based on the
    cosine similarity between the comments and the text of the case, they will
    be the top and worst.

    Args:
        comments_amount (int): Number of comments received.
    
    Returns:
        int: Number of comments that will be winners (top or worst).
    '''
    # return math.ceil(finalists_amount / 10)
    return 5

def validate_total_comments_amount(comments_amount):
    minimum_required = 10
    if comments_amount < minimum_required:
        raise ValueError(f"ERROR: comments_amount {comments_amount} is less than the required mimimun amount of comments {minimum_required}")

def validation_amount_comments(comments_amount, finalists_amount, winners_amount):
    '''
    Validate that the number of finalist and winning comments is adequate.

    Args:
        comments_amount (int): Number of comments received in total.
        finalists_amount (int): Number of finalist comments.
        winners_amount (int): Number of winners comments.
    
    Raises:
        ERROR: Amount is more than comments_amount or finalists_amount.
    '''
    if finalists_amount > comments_amount:
        raise ValueError(f"ERROR: finalists_amount {finalists_amount} is more than comments_amount")
    if winners_amount > comments_amount:
        raise ValueError(f"ERROR: winners_amount {winners_amount} is more than comments_amount")
    if winners_amount > finalists_amount:
        raise ValueError(f"ERROR: winners_amount {winners_amount} is more than finalists_amount")

def filter_comments(comments_list):
    '''
    Filter comments with less than 5 words

    Args:
        comments_list (List[List[str,int]]): Comment list received.
    
    Returns:
        List[List[str,int]]: Filtered comment list without short comments.
    '''
    filtered_comments = []
    
    for comment in comments_list:
        words = comment[0].split()
        if len(words) >= 5:
            filtered_comments.append(comment)
    
    return filtered_comments

@celery.task(name= 'client_callback', max_retry=10, default_retry_delay=3*60)
def client_callback(result):
    url = result['context']['callback_url']
    headers = {'x-api-key': validation_api_key}
    response = requests.post(url, json=result, headers=headers)
    return {'result': result}

def extract_text_from_pdf_url(pdf_url):
    response = requests.get(pdf_url)
    if response.status_code == 200:
        pdf_content = BytesIO(response.content)
        pdf_reader = PdfReader(pdf_content)

        text = ''
        for page_num in range(len(pdf_reader.pages)):
            page = pdf_reader.pages[page_num]
            text += page.extract_text()

        return text
    else:
        raise ValueError(f"ERROR: PDF file not found or URL could not be reached")
        return ''

def clean_text(text):
    text = text.replace(",", "").replace(".", "")
    text = text.lower()
    return text

def remove_stop_word_from_text(text):
    text = ' '.join([x.lower() for x in text.replace('.', '').replace(',', '').split() if x.lower() not in stop_words])
    return text

def get_embbedings_from_text(model, text):
    
    hash_key = sha1_hash(text)
    
    if validate_Redis_key(hash_key):
        text_embedding_element = retrive_Redis_element(hash_key)
        embeddings = string_list_to_float(text_embedding_element)
        
        return embeddings
    else:
        embeddings = texts_to_embeddings(model, [text])[0]
        text_embedding_element = float_list_to_string(embeddings)
        push_Redis_element(hash_key, text_embedding_element)
        
        return embeddings
    
@celery.task(name= 'get-top-worst-comments', serializer='json', bind=True, queue='celery', options={'queue': 'celery'}, max_retry=10, ignore_result=False, default_retry_delay=3*60)
def get_top_worst_comments(self, params, model):
    '''
    Get top and worst comments.

    Gets the best and worst comments based on a model, a question, a case text,
    and a list of comments.

    Args:
        params (Dict[str, Union[str, str, str, List[str]]]): model, question, case text, comments.
    
    Returns:
        Dict[str, Union[List[[float, str]], List[[float, str]]]]: top and worst list.
    '''
    model = models[model]
    case_text_url = params['content']['case_url']
    phase_contents = params['content']['phase_content']
    
    case_text = extract_text_from_pdf_url(case_text_url)
    case_text = remove_stop_word_from_text(case_text)
    
    response_selection = []
    for i in range(len(phase_contents)):
        
        question = params['content']['phase_content'][i]['question']
        question_id = params['content']['phase_content'][i]['question_id']
        
        responses = params['content']['phase_content'][i]['responses']
        
        
        ordered_responses = [[response["response_text"], response["response_id"], response["user_id"]] for response in responses]
        print("ordered_responses: ", ordered_responses)
        question_embedding = get_embbedings_from_text(model, question)
        case_text_embedding = get_embbedings_from_text(model, case_text)
        filtered_comments = filter_comments(ordered_responses)
        
        comments = []
        for comment_element in filtered_comments:
            comment_string = comment_element[0]
            comment_id = comment_element[1]
            user_id = comment_element[2]
            
            processed_comment = clean_text(comment_string)
            
            dic = {'text': comment_string, 'embedding': get_embbedings_from_text(model, processed_comment), 'id': comment_id, 'user_id': user_id}
            comments.append(dic)
        
        validate_total_comments_amount(len(comments))
        finalists_amount = get_finalist_amount_from(len(ordered_responses))
        winners_amount = get_winners_amount_from(finalists_amount)

        top_comments, worst_comments = get_top_worst_classification(question_embedding, case_text_embedding, comments, finalists_amount, winners_amount)
        
        # top worst comments structure => [[comment, str(similarity), id, user_id],...]
        response_structure = []
        for idx, comment in enumerate(top_comments):
            response_dic_top = {"ranking_type":'top', "ranking": idx+1,"response_id": comment[2], "user_id": comment[3],"response_text": comment[0]}
            response_structure.append(response_dic_top)
        
        for idx, comment in enumerate(worst_comments):
            response_dic_worst = {"ranking_type":'worst', "ranking": idx+1,"response_id": comment[2], "user_id": comment[3], "response_text": comment[0]}
            response_structure.append(response_dic_worst)
        
        response_selection_dic = {'question_id': question_id, 'responses': response_structure}
        response_selection.append(response_selection_dic)
    
    context = params['context']
    
    return {'context': context, 'response_selections': response_selection}

def float_list_to_string(floats):
    strings = [str(f) for f in floats]
    return strings

def string_list_to_float(strings):
    floats = [float(item) for item in strings]
    return floats

def sha1_hash(input_string):
    sha1 = hashlib.sha1()
    sha1.update(input_string.encode('utf-8'))
    return sha1.hexdigest()

def validate_Redis_key(key):
    return r.exists(key)

def retrive_Redis_element(key):
    stored_element = r.lrange(key, 0, -1)
    return stored_element

def push_Redis_element(key, element):
    r.rpush(key, *element)
    

#comment = [{text, embedding}, ...]

def get_top_worst_classification(question_embedding, case_text_embedding, comments, finalists_amount, winners_amount):
    comments_question_similarity = []
    
    validation_amount_comments(len(comments), finalists_amount, winners_amount)
    
    for comment in comments:
        similarity = cosine_similarity(question_embedding, comment['embedding'])
        comments_question_similarity.append([comment['text'], similarity, comment['embedding'], comment['id'], comment['user_id']])
    
    # Lambda function to the Similarity
    comments_question_similarity.sort(key=lambda x: x[1], reverse = True)
    
    # Top Comments
    comments_case_similarity_top = []
    for comment, _similarity, comment_embedding, id, user_id in comments_question_similarity[  : finalists_amount]:
        similarity = cosine_similarity(case_text_embedding, comment_embedding)
        comments_case_similarity_top.append([comment, str(similarity), id, user_id])
    
    comments_case_similarity_top.sort(key=lambda x: x[1], reverse = True)
    
    top_comments = comments_case_similarity_top[  : winners_amount]
    
    # Worst Comments
    comments_case_similarity_worst = []
    for comment, _similarity, comment_embedding, id, user_id in comments_question_similarity[-finalists_amount :  ]:
        similarity = cosine_similarity(case_text_embedding, comment_embedding)
        comments_case_similarity_worst.append([comment, str(similarity), id, user_id])
    
    comments_case_similarity_worst.sort(key=lambda x: x[1], reverse = False)
    
    worst_comments = comments_case_similarity_worst[ : winners_amount]
    
    return top_comments, worst_comments
    
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)