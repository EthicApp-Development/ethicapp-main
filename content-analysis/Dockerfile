FROM python:3.8

WORKDIR /app
COPY . /app

COPY requirements.txt /app

# Agregar content-analysis al PYTHONPATH
ENV PYTHONPATH=/app/content-analysis:$PYTHONPATH

RUN pip install --upgrade pip && \
    pip install -r requirements.txt

EXPOSE 5000

CMD ["python", "./content-analysis/app.py"]
