const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const authenticateToken = require('../../api/v2/middleware/authenticateToken')
const checkAbility = require('../v2/middleware/checkAbility');


// Import Model
const { Phase, Activity, Design, Question } = require('../../api/v2/models');
// Configure body-parser to process the body of requests in JSON format.

router.use(bodyParser.json());

// Read
router.get('/phases', async (req, res) => {
  try {
    const phases = await Phase.findAll();
    res.status(200).json({ status: 'success', data: phases });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Create
router.post('/phases', authenticateToken, checkAbility('create', 'Phase'), async (req, res) => {
  const { number, type, anon, chat, prev_ans, activity_id } = req.body;
  try {

    const activity = await Activity.findByPk(activity_id);
    if (!activity) {
      return res.status(400).json({ status: 'error', message: 'Activity not found' });
    }

    const design = await Design.findByPk(activity.design);
    if (!design) {
      return res.status(400).json({ status: 'error', message: 'Design not found' });
    }

    // Validate that the phase number is not duplicated in the design
    const phaseNumbers = design.design.phases.map(phase => phase.number);
    if (phaseNumbers.includes(number)) {
      return res.status(400).json({ status: 'error', message: 'Phase number already exists in the design' });
    }
    // const repeatNumber = await Phase.findOne({ where: { number: number } });
    // if (repeatNumber) {
    //   return res.status(400).json({ status: 'error', message: 'Phase number already exists in Phase table' });
    // }

    const phase = await Phase.create({ number, type, anon, chat, prev_ans, activity_id });
    return res.status(201).json({ status: 'success', data: phase });

  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Update
router.put('/phases/:id', authenticateToken, checkAbility('update', 'Phase'), async (req, res) => {
  const { id } = req.params;
  try {
    const phase = await Phase.findByPk(id);
    if (!phase) {
      return res.status(404).json({ status: 'error', message: 'Phase not found' });
    }
    await phase.update(req.body);
    res.json({ status: 'success', data: phase });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});


// Delete
router.delete('/phases/:id', checkAbility('delete', 'Phase'), async (req, res) => {
  const { id } = req.params;
  try {
    const phase = await Phase.findByPk(id);
    if (!phase) {
      return res.status(404).json({ status: 'error', message: 'Phase not found' });
    }
    await phase.destroy();
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

//one phase
router.get('/phases/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const phase = await Phase.findByPk(id);
    res.json({ status: 'success', data: phase });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});


// POST /api/v2/phases/:id/questions
router.post('/phases/:id/questions', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { text, content, additional_info, type, session_id, number, phase_id } = req.body;

  try {
    const phase = await Phase.findByPk(id);
    if (!phase) {
      return res.status(400).json({ status: 'error', message: 'Phase not found' });
    }
    //console.log(phase)
    const activity = await Activity.findByPk(phase.activity_id);
    //console.log(activity)
    if (!activity) {
      return res.status(400).json({ status: 'error', message: 'Activity not found' });
    }
    const design = await Design.findByPk(activity.design);
    //console.log(design)
    if (!design) {
      return res.status(400).json({ status: 'error', message: 'Design not found' });
    }
    //console.log(design.design.phases.length)
    const amountQuestionNumber = design.design.phases.length
    const phaseNumbers = design.design.phases.map(phase => phase.number);
    //console.log(phaseNumbers)
    //console.log(questionsNumbers)
    for (let pos = 0; pos < amountQuestionNumber; pos++) {
      const questionsNumbers = design.design.phases[pos].question.map(questionNumber => questionNumber.number)
      //console.log(`position -> ${pos} <-`, questionsNumbers)
      if (questionsNumbers.includes(number)) {
        console.log('ya incluye esta pregunta')
        return res.status(400).json({ status: 'error', message: `question number already exists in the phase in Design, is in ${pos + 1} question in phase` });
      }
      else {
        console.log('no la incluye')
      }
    }

    const question = await Question.create({
      text,
      content,
      additional_info,
      type,
      session_id,
      number,
      phase_id: id
    });

    res.status(201).json({ status: 'success', data: question });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});


// GET /api/v2/phases/:id/questions
router.get('/phases/:id/questions', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const phase = await Phase.findByPk(id, {
      include: [{ model: Question, as: 'questions' }]
    });

    if (!phase) {
      return res.status(400).json({ status: 'error', message: 'Phase not found' });
    }
    //console.log(phase.questions)
    res.status(200).json({ status: 'success', data: phase.questions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

module.exports = router;
