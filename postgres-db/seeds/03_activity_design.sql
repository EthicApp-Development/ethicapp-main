INSERT INTO designs(creator, public, locked, design)
VALUES
(2, false, false, '{
  "type": "semantic_differential",
  "roles": [],
  "phases": [
    {
      "chat": false,
      "mode": "individual",
      "anonymous": false,
      "questions": [
        {
          "q_text": "1+4=?",
          "ans_format": {
            "l_pole": "1",
            "r_pole": "7",
            "values": 7,
            "just_required": false,
            "min_just_length": 5
          }
        }
      ],
      "stdntAmount": 3,
      "grouping_algorithm": "random",
      "prevPhasesResponse": []
    }
  ],
  "metainfo": {
    "title": "hello-world-design",
    "author": "template",
    "creation_date": 1679954482351
  }
}');
