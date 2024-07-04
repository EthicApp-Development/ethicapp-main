#tasks.py
from celery import Celery, signals
from text_analysis import score_words, texts_to_embeddings, topics, cosine_similarity
from use_language_model import USELanguageModel
from kombu import Queue, Exchange
import redis
from pypdf import PdfReader
import hashlib
from stop_words import stop_words
from io import BytesIO
import requests
import math
import os

redis_host_name = os.environ.get("REDIS_HOST_NAME", 'localhost')

app = Celery('tasks',
                    broker=f'redis://{redis_host_name}:6379/0',
                    backend=f'redis://{redis_host_name}:6379/0',
                    include=['tasks'])

app.conf.task_queues = [
    Queue('celery', routing_key='celery', max_length=1, exchange=Exchange('celery')),
    Queue('emb', routing_key='emb', max_length=1, exchange=Exchange('emb'))
]

app.conf.task_routes = {
    'tasks.get_top_worst_comments': {'queue': 'celery'}
}

r = redis.Redis(host=redis_host_name, port=6379, decode_responses=True)

model_instance = None

@signals.worker_process_init.connect
def init_worker(**kwargs):
    global model_instance
    model_instance = USELanguageModel()

def client_callback(result):
    url = result['context']['callback_url']
    headers = {'x-api-key': os.environ.get("CONTENT_ANALYSIS_API_KEY")}
    try:
        response = requests.post(url, json=result, headers=headers)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"Error sending callback: {e}")

@app.task(name='tasks.get_top_worst_comments', serializer='json', bind=True, queue='celery', options={'queue': 'celery'}, max_retry=10, ignore_result=False, default_retry_delay=3*60)
def get_top_worst_comments(self, params, model):
    global model_instance
    case_text_url = params['content']['case_url']
    phase_contents = params['content']['phase_content']
    
    case_text = extract_text_from_pdf_url(case_text_url)
    case_text = remove_stop_word_from_text(case_text)
    
    response_selection = []
    for i, phase_content in enumerate(phase_contents):
        question = phase_content['question']
        question_id = phase_content['question_id']
        responses = phase_content['responses']
        
        ordered_responses = [[response["response_text"], response["response_id"], response["user_id"]] for response in responses]
        question_embedding = get_embeddings_from_text(model_instance, question)
        case_text_embedding = get_embeddings_from_text(model_instance, case_text)
        filtered_comments = filter_comments(ordered_responses)
        
        comments = []
        for comment_string, comment_id, user_id in filtered_comments:
            processed_comment = clean_text(comment_string)
            dic = {
                'text': comment_string,
                'embedding': get_embeddings_from_text(model_instance, processed_comment),
                'id': comment_id,
                'user_id': user_id
            }
            comments.append(dic)
        
        validate_total_comments_amount(len(comments))
        finalists_amount = get_finalist_amount_from(len(ordered_responses))
        winners_amount = get_winners_amount_from(finalists_amount)

        top_comments, worst_comments = get_top_worst_classification(question_embedding, case_text_embedding, comments, finalists_amount, winners_amount)
        
        response_structure = [
            {"ranking_type": 'top', "ranking": idx + 1, "response_id": comment[2], "user_id": comment[3], "response_text": comment[0]}
            for idx, comment in enumerate(top_comments)
        ] + [
            {"ranking_type": 'worst', "ranking": idx + 1, "response_id": comment[2], "user_id": comment[3], "response_text": comment[0]}
            for idx, comment in enumerate(worst_comments)
        ]
        
        response_selection.append({'question_id': question_id, 'responses': response_structure})
    
    context = params['context']
    result  = {'context': context, 'response_selections': response_selection}
    client_callback(result)
    
    return result

def extract_text_from_pdf_url(pdf_url):
    response = requests.get(pdf_url)
    if response.status_code == 200:
        pdf_content = BytesIO(response.content)
        pdf_reader = PdfReader(pdf_content)
        text = ''.join(page.extract_text() for page in pdf_reader.pages)
        return text
    else:
        raise ValueError(f"ERROR: PDF file not found or URL could not be reached")

def clean_text(text):
    return text.replace(",", "").replace(".", "").replace("'", "").replace('"', '').lower()

def delete_quotation_marks(text):
    return text.replace("'", "").replace('"', '')

def remove_stop_word_from_text(text):
    return ' '.join([x.lower() for x in text.replace('.', '').replace(',', '').split() if x.lower() not in stop_words])

def sha1_hash(input_string):
    sha1 = hashlib.sha1()
    sha1.update(input_string.encode('utf-8'))
    return sha1.hexdigest()

def validate_redis_key(key):
    return r.exists(key)

def retrieve_redis_element(key):
    return r.lrange(key, 0, -1)

def push_redis_element(key, element):
    r.rpush(key, *element)

def filter_comments(comments_list):
    return [comment for comment in comments_list if len(comment[0].split()) >= 5]

def get_finalist_amount_from(comments_amount):
    return math.ceil(comments_amount / 2)

def get_winners_amount_from(finalists_amount):
    return 5

def validate_total_comments_amount(comments_amount):
    minimum_required = 10
    if comments_amount < minimum_required:
        raise ValueError(f"ERROR: comments_amount {comments_amount} is less than the required minimum amount of comments {minimum_required}")

def validation_amount_comments(comments_amount, finalists_amount, winners_amount):
    if finalists_amount > comments_amount:
        raise ValueError(f"ERROR: finalists_amount {finalists_amount} is más than comments_amount")
    if winners_amount > comments_amount:
        raise ValueError(f"ERROR: winners_amount {winners_amount} is más than comments_amount")
    if winners_amount > finalists_amount:
        raise ValueError(f"ERROR: winners_amount {winners_amount} is más than finalists_amount")

def float_list_to_string(floats):
    return [str(f) for f in floats]

def string_list_to_float(strings):
    return [float(item) for item in strings]

def get_embeddings_from_text(model, text):
    hash_key = sha1_hash(text)
    if validate_redis_key(hash_key):
        text_embedding_element = retrieve_redis_element(hash_key)
        embeddings = string_list_to_float(text_embedding_element)
    else:
        embeddings = texts_to_embeddings(model, [text])[0]
        text_embedding_element = float_list_to_string(embeddings)
        push_redis_element(hash_key, text_embedding_element)
    return embeddings

def get_top_worst_classification(question_embedding, case_text_embedding, comments, finalists_amount, winners_amount):
    comments_question_similarity = []
    validation_amount_comments(len(comments), finalists_amount, winners_amount)
    
    for comment in comments:
        similarity = cosine_similarity(question_embedding, comment['embedding'])
        comments_question_similarity.append([comment['text'], similarity, comment['embedding'], comment['id'], comment['user_id']])
    
    comments_question_similarity.sort(key=lambda x: x[1], reverse=True)
    
    comments_case_similarity_top = [
        [delete_quotation_marks(comment), str(cosine_similarity(case_text_embedding, comment_embedding)), id, user_id]
        for comment, _similarity, comment_embedding, id, user_id in comments_question_similarity[:finalists_amount]
    ]
    comments_case_similarity_top.sort(key=lambda x: x[1], reverse=True)
    top_comments = comments_case_similarity_top[:winners_amount]
    
    comments_case_similarity_worst = [
        [delete_quotation_marks(comment), str(cosine_similarity(case_text_embedding, comment_embedding)), id, user_id]
        for comment, _similarity, comment_embedding, id, user_id in comments_question_similarity[-finalists_amount:]
    ]
    comments_case_similarity_worst.sort(key=lambda x: x[1], reverse=False)
    worst_comments = comments_case_similarity_worst[:winners_amount]
    
    return top_comments, worst_comments
