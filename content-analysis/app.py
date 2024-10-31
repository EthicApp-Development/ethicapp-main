import os
from flask import Flask, request, jsonify, url_for
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from celery import Celery, chain, signature

app = Flask(__name__)
app.config.from_object(os.getenv('APP_SETTINGS', "config.DevelopmentConfig"))

redis_host_name = os.environ.get("REDIS_HOST_NAME")
# Configuración de Celery
def make_celery(app):
    celery = Celery(
        app.import_name,
        broker=f'redis://{redis_host_name}:6379/0',
        backend=f'redis://{redis_host_name}:6379/0',
    )
    celery.conf.update(app.config)
    return celery

celery = make_celery(app)

@app.route('/top-worst', methods=['POST'])
def top_worst_embeddings():
    api_key = request.headers.get('x-api-key')

    if api_key is None or api_key != os.environ.get("CONTENT_ANALYSIS_API_KEY"):
        return jsonify({"error": "Unauthorized"}), 401
    
    params = request.get_json()
    model = 'use'
    send_task(params, model)
    return jsonify(params), 200

def send_task(params, model):
    
    celery.send_task('tasks.get_top_worst_comments', kwargs={'params': params, 'model': model})
    
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
