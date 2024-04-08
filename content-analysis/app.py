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

models = {'use': USELanguageModel()}

app = Flask(__name__)
app.config.from_object(os.getenv('APP_SETTINGS',"config.DevelopmentConfig"))
db = SQLAlchemy(app)
migrate = Migrate(app, db, compare_type=True)
#from models import Comments, Process, Topics

redis_ulr = os.environ.get("REDIS_URL")
if not redis_ulr:
    redis_ulr = 'localhost' 
    
celery = Celery('tasks',
    broker=f'redis://{redis_ulr}:6379/0',
    backend=f'redis://{redis_ulr}:6379/0',
    include=['app','celery'])

celery.conf.task_queues = [
    Queue('celery', routing_key='celery', max_length=1, exchange=Exchange('celery')),
    Queue('emb', routing_key='emb', max_length=1, exchange=Exchange('emb'))
]

celery.conf.task_routes = {'celery.get-top-worst-comments': {'queue': 'celery'}, 'celery.client_callback': {'queue': 'celery'}}
celery.autodiscover_tasks(['celery.get-top-worst-comments'], force=True)
celery.autodiscover_tasks(['celery.client_callback'], force=True)

r = redis.Redis(host=f'{redis_ulr}', port=6379, decode_responses=True)

def task_chain(params,model):
    res = chain(get_top_worst_comments.s(params, model), client_callback.s()).apply_async()

@app.route('/top-worst/', methods=['POST'])
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
    response = requests.post(url,json=result)
    return {'result': result}

def extract_text_from_pdf_url(pdf_url):
    print("in loop: ")
    response = requests.get(pdf_url)
    print("url_response: ", response)
    if response.status_code == 200:
        pdf_content = BytesIO(response.content)
        pdf_reader = PdfReader(pdf_content)

        text = ''
        for page_num in range(len(pdf_reader.pages)):
            page = pdf_reader.pages[page_num]
            text += page.extract_text()

        return text
    else:
        return ''

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
    print("case text: ",case_text)
    print("phase content: ", phase_contents)
    
    response_selection = []
    for i in range(len(phase_contents)):
        
        question = params['content']['phase_content'][i]['question']
        question_id = params['content']['phase_content'][i]['question_id']
        
        responses = params['content']['phase_content'][i]['responses']
        
        
        ordered_responses = [[response["response_text"],response["response_id"]] for response in responses]
        
        question_embedding = get_embbedings_from_text(model, question)
        case_text_embedding = get_embbedings_from_text(model, case_text)
        filtered_comments = filter_comments(ordered_responses)
        
        comments = []
        for comment_element in filtered_comments:
            comment_string = comment_element[0]
            comment_id = comment_element[1]
            
            dic = {'text': comment_string, 'embedding': get_embbedings_from_text(model, comment_string), 'id': comment_id}
            comments.append(dic)
         
        finalists_amount = get_finalist_amount_from(len(ordered_responses))
        winners_amount = get_winners_amount_from(finalists_amount)

        top_comments = get_top_comments(question_embedding, case_text_embedding, comments, finalists_amount, winners_amount)
        worst_comments = get_worst_comments(question_embedding, case_text_embedding, comments, finalists_amount, winners_amount)
        
        response_structure = []
        for idx, comment in enumerate(top_comments):
            response_dic_top = {"ranking_type":'top', "ranking": idx+1,"response_id": comment[2],"response_text": comment[0]}
            response_structure.append(response_dic_top)
        
        for idx, comment in enumerate(worst_comments):
            response_dic_worst = {"ranking_type":'worst', "ranking": idx+1,"response_id": comment[2],"response_text": comment[0]}
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
def get_top_comments(question_embedding, case_text_embedding, comments, finalists_amount, winners_amount):
    '''
    Get top comments with cosine similarity.

    Args:
        question_embedding (List[float]): Embedding of question.
        case_text_embedding (List[float]): Embedding of case text.
        comments (Dict[str, Union[str, float]]): Comments with their embedding.
        finalists_amount (int): finalists amount of comments.
        winners_amount (int): winners amount of comments.
    
    Returns:
        List[[float, str]]: List of tops comments with their cosine similarity.
    '''
    comments_question_similarity = []
    
    validation_amount_comments(len(comments), finalists_amount, winners_amount)

    for comment in comments:
        similarity = cosine_similarity(question_embedding, comment['embedding'])
        comments_question_similarity.append([comment['text'], similarity, comment['embedding'], comment['id']])

    comments_question_similarity.sort(key=lambda x: x[1], reverse = True)

    comments_case_similarity = []
    for comment, _similarity, comment_embedding, id in comments_question_similarity[0:finalists_amount]:
        similarity = cosine_similarity(case_text_embedding, comment_embedding)
        comments_case_similarity.append([comment, str(similarity), id])
    
    comments_case_similarity.sort(key=lambda x: x[1], reverse = True)

    top_comments = comments_case_similarity[0:winners_amount]
    return top_comments


def get_worst_comments(question_embedding, case_text_embedding, comments, finalists_amount, winners_amount):
    '''
    Get worst comments with cosine similarity.

    Args:
        question_embedding (List[float]): Embedding of question.
        case_text_embedding (List[float]): Embedding of case text.
        comments (Dict[str, Union[str, float]]): Comments with their embedding.
        finalists_amount (int): finalists amount of comments.
        winners_amount (int): winners amount of comments.
    
    Returns:
        List[[float, str]]: List of worst comments with their cosine similarity.
    '''
    comments_question_similarity = []
    
    validation_amount_comments(len(comments), finalists_amount, winners_amount)

    for comment in comments:
        similarity = cosine_similarity(question_embedding, comment['embedding'])
        comments_question_similarity.append([comment['text'], similarity, comment['embedding'], comment['id']])

    comments_question_similarity.sort(key=lambda x: x[1], reverse = False)

    comments_case_similarity = []
    for comment, _similarity, comment_embedding, id in comments_question_similarity[0:finalists_amount]:
        similarity = cosine_similarity(case_text_embedding, comment_embedding)
        comments_case_similarity.append([comment, str(similarity), id])
    
    comments_case_similarity.sort(key=lambda x: x[1], reverse = False)

    worst_comments = comments_case_similarity[0:winners_amount]
    return worst_comments

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)