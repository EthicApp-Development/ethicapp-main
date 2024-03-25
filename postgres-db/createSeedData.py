# -*- coding: utf-8 -*-
"""
Created on Thu Nov  9 16:54:22 2023

@author: User
"""

'''
DELETE FROM report_activity;
DELETE FROM report_create_account;
DELETE FROM report_login;
'''

import random

from datetime import datetime, timedelta

def is_first_monday_of_month(date_str):
    # Convert the date string to a datetime object
    date = datetime.strptime(date_str, "%Y-%m-%d")

    # Check if the day is Monday (0 corresponds to Monday)
    if date.weekday() == 0:
        # Check if it is the first Monday of March or August
        if (date.month == 3 and date.day <= 7) or (date.month == 8 and date.day <= 7):
            return True
    return False

# Get today's date
today = datetime.now()

# Define a timedelta for two years
two_years_ago = timedelta(days=365 * 2)

# Calculate the start date (two years ago from today)
start_date = today - two_years_ago

courses=13
studentsPerCourse=23
teachersPerCourse=1

teachersIds=[34,39,40,41,42,43,44,45,46,47,48,49,50]

with open('output.txt', 'w') as file:
    print("INSERT INTO report_login (login_date, is_teacher, count) VALUES", file=file)
    
    # Iterate over each date from start_date to today
    current_date = start_date
    while current_date <= today:
        # Check if the current date is a weekday (Monday to Friday)
        randomMulti = random.uniform(1, 2.500001)
        studentsLogins=int(courses*studentsPerCourse*randomMulti)
        teacherLogins=int(courses*teachersPerCourse*randomMulti)
        
        if current_date.weekday() < 5:
            if current_date == today:
                print(f"('{current_date.strftime('%Y-%m-%d')}',CAST(0 AS BIT),{studentsLogins}),",file=file)
                print(f"('{current_date.strftime('%Y-%m-%d')}',CAST(1 AS BIT),{teacherLogins});",file=file)
            else:
                print(f"('{current_date.strftime('%Y-%m-%d')}',CAST(0 AS BIT),{studentsLogins}),",file=file)
                print(f"('{current_date.strftime('%Y-%m-%d')}',CAST(1 AS BIT),{teacherLogins}),",file=file)
        # Move to the next day
        current_date += timedelta(days=1)



    print("", file=file)
    print("", file=file)
    
    
    print("INSERT INTO report_create_account (creation_date, is_teacher, count) VALUES", file=file)
    current_date = start_date
    while current_date <= today:
        # Check if the current date is a weekday (Monday to Friday)
        randomMulti = random.uniform(0,0.15)
        randomMulti2 = random.uniform(0,0.10)
        
        studentsCreateAccount=int(courses*studentsPerCourse*randomMulti)
        teacherCreateAccount=int(courses*teachersPerCourse*randomMulti2)
        
        
        if current_date.weekday() < 5:
            if is_first_monday_of_month(current_date.strftime('%Y-%m-%d')):
                print(f"('{current_date.strftime('%Y-%m-%d')}',CAST(0 AS BIT),{courses*studentsPerCourse}),",file=file)
                print(f"('{current_date.strftime('%Y-%m-%d')}',CAST(1 AS BIT),{courses*teachersPerCourse}),",file=file)
            else: 
                if current_date != today:
                    print(f"('{current_date.strftime('%Y-%m-%d')}',CAST(1 AS BIT),{teacherCreateAccount}),",file=file)
                    print(f"('{current_date.strftime('%Y-%m-%d')}',CAST(0 AS BIT),{studentsCreateAccount}),",file=file)
                else:
                    print(f"('{current_date.strftime('%Y-%m-%d')}',CAST(1 AS BIT),{teacherCreateAccount}),",file=file)
                    print(f"('{current_date.strftime('%Y-%m-%d')}',CAST(0 AS BIT),{studentsCreateAccount});",file=file)
        # Move to the next day
        current_date += timedelta(days=1)


    print("", file=file)
    print("", file=file)
    
    print("INSERT INTO report_activity (creation_date, professor, count) VALUES", file=file)
    current_date = start_date
    while current_date <= today:
        # Check if the current date is a weekday (Monday to Friday)        
        if current_date.weekday() < 5:
            for index, item in enumerate(teachersIds):
                
                randomActivityStart = int(random.uniform(0,15))
                
                if index == len(teachersIds) - 1 and current_date == today:
                    # Special logic for the last item
                    print(f"('{current_date.strftime('%Y-%m-%d')}',{item},{randomActivityStart});",file=file)
                else:
                    # Regular logic for other items
                    print(f"('{current_date.strftime('%Y-%m-%d')}',{item},{randomActivityStart}),",file=file)
        # Move to the next day
        current_date += timedelta(days=1)
