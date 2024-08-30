
def isUpdate(data, comments, cluster):
    if comments[0].score:
        return False
    elif len(data) > len(comments):
       return  True



