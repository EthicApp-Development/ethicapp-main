const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();

// Import Model
const { Question, Response, Session, Phase, User, Design, Activity } = require('../../api/v2/models');

// Configure body-parser to process the body of requests in JSON format.

router.use(bodyParser.json());

// Read
router.get('/designs', async (req, res) => {
  try {
    const designs = await Design.findAll();
    res.status(200).json({ status: 'success', data: designs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Create
router.post('/designs', async (req, res) => {
  try {
    const design = await Design.create(req.body);
    res.status(201).json({ status: 'success', data: design });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Update
router.put('/designs/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const design = await Design.findByPk(id);
    if (!design) {
      return res.status(404).json({ status: 'error', message: 'Design not found' });
    }
    await design.update(req.body);
    res.json({ status: 'success', data: design });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Delete
router.delete('/designs/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const design = await Design.findByPk(id);
    if (!design) {
      return res.status(404).json({ status: 'error', message: 'Design not found' });
    }
    await design.destroy();
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

router.post('/designs/:id/phases', async (req, res) => {
  const { number, type, anon, chat, prev_ans, activity_id } = req.body;
  let designId, numberPhases
  const { id } = req.params;
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
    if (phaseNumber) {
      return res.status(400).json({ status: 'error', message: 'phase number is exist in the design' });
    }
    const phase = await Phase.create({ number, type, anon, chat, prev_ans, activity_id });
    return res.status(201).json({ status: 'success', data: phase });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

router.post('/designs/:id/phases/:phase_number/questions', async (req, res) => {
  const { text, content, additional_info, type, session_id, number } = req.body;
  let boolQuestionNumber = false;
  const { id, phase_number } = req.params;
  try {
    const session = await Session.findByPk(session_id);
    if (!session) {
      return res.status(400).json({ status: 'error', message: 'Session not found' });
    }
    //console.log(session)
    const sessionCreator = session.creator;
    const design = await Design.findOne({ where: { creator: sessionCreator } });
    if (!design) {
      return res.status(400).json({ status: 'error', message: 'Design not found for this question' });
    }
    //console.log(design.dataValues)
    if (!design.dataValues.design.phases) {
      return res.status(400).json({ status: 'error', message: 'Design is missing phases' });
    }

    const phases = design.dataValues.design.phases;
    let updatedPhases = phases.map(phase => {
      // Check if the phase already contains a question with the same number
      if (phase.question.some(q => q.number === number)) {
        boolQuestionNumber = true;
      }
      return phase;
    });

    if (boolQuestionNumber) {
      return res.status(400).json({ status: 'error', message: 'Question already exists for this phase' });
    } else {
      // Add new question to the phases that do not already contain the question with the same number
      const newQuestion = { text, content, additional_info, type, session_id, number };
      updatedPhases = phases.map(phase => {
        if (!phase.question.some(q => q.number === number)) {
          phase.question.push(newQuestion);
        }
        return phase;
      });

      // Update the design with the new question
      await Design.update(
        { design: { phases: updatedPhases } },
        { where: { creator: sessionCreator } }
      );
    }

    const question = await Question.create(req.body);
    res.status(201).json({ status: 'success', data: question });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// design one | used in one test
// router.get('/designs/:profeId/:numberphase/:numberquestion', async (req, res) => {
//   const { numberphase, numberquestion, profeId } = req.params;
//   //console.log("llega")
//   try {
//     const design = await Design.findOne({
//       where: {
//         creator: profeId // Assuming the user ID is stored in req.user.id after authentication
//       }
//     });
//     if (!design) {
//       return res.status(404).json({ status: 'error', message: 'Design not found' });
//     }

//     const phases = design.design.phases;
//     const phase = phases.find(p => p.number === parseInt(numberphase));

//     if (!phase) {
//       return res.status(404).json({ status: 'error', message: 'Phase not found' });
//     }

//     const question = phase.question.find(q => q.number === parseInt(numberquestion));

//     if (!question) {
//       return res.status(404).json({ status: 'error', message: 'Question not found' });
//     }

//     res.status(200).json({ status: 'success', data: question });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ status: 'error', message: 'Internal server error' });
//   }
// });


module.exports = router;
