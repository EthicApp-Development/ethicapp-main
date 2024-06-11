const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const { Phase, Activity, Design, Question } = require('../../api/v2/models');
const authenticateToken = require('../../api/v2/middleware/authenticateToken')
// Import Model

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
router.post('/phases', authenticateToken, async (req, res) => {
  const { number, type, anon, chat, prev_ans, activity_id } = req.body;
  const { role } = req.user;
  if (role !== 'P') {
    return res.status(403).json({ status: 'error', message: 'Only professors can create sessions' });
  }
  try {

    const activity = await Activity.findByPk(activity_id);
    if (!activity) {
      return res.status(400).json({ status: 'error', message: 'Activity not found' });
    }

    const designTable = await Design.findByPk(activity.design)
    if (!designTable) {
      return res.status(400).json({ status: 'error', message: 'Design not found' });
    }
    else {
      const phase = await Phase.create({ number, type, anon, chat, prev_ans, activity_id });
      return res.status(201).json({ status: 'success', data: phase });
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Update
router.put('/phases/:id', authenticateToken, async (req, res) => {
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
router.delete('/phases/:id', async (req, res) => {
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

router.post('/phases/design', async (req, res) => {
  const { number, type, anon, chat, prev_ans, activity_id } = req.body;
  let designId, numberPhases
  try {
    const activity = await Activity.findByPk(activity_id);
    if (!activity) {
      return res.status(400).json({ status: 'error', message: 'Activity not found' });
    }
    
    designId = activity.design
    const design = await Design.findByPk(designId);
    numberPhases = design.design.phases
    const phaseNumber = numberPhases.find(d => d.number === number)
    //console.log(phaseNumber)
    if(phaseNumber){
      return res.status(400).json({ status: 'error', message: 'phase number is exist in the design' });
    }
    const phase = await Phase.create({ number, type, anon, chat, prev_ans, activity_id });
    return res.status(201).json({ status: 'success', data: phase });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// POST /api/v2/phases/:id/questions
router.post('/phases/:id/questions', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { text, content, additional_info, type, session_id, number } = req.body;

  try {
    const phase = await Phase.findByPk(id);
    if (!phase) {
      return res.status(400).json({ status: 'error', message: 'Phase not found' });
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

    res.status(200).json({ status: 'success', data: phase.questions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

module.exports = router;
