const express = require('express');
const bodyParser = require('body-parser'); // Importbody-parser
const router = express.Router();

// Import Model

const { Question, Design, Session  } = require('../../api/v2/models');

// Configure body-parser to process the body of requests in JSON format.
router.use(bodyParser.json());

// Read
router.get('/questions', async (req, res) => {
    try {
        const questions = await Question.findAll();
        res.status(200).json({ status: 'success', data: questions });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Create
router.post('/questions', async (req, res) => {
    // const { text, /*phases_id*/ } = req.body;
    // if (!phases_id) {
    //     return res.status(400).json({ status: 'error', message: 'phases_id is required' });
    // }
    try {
        // const phase = await Phase.findByPk(phases_id);
        // if (!phase) {
        //     return res.status(400).json({ status: 'error', message: 'Phase not found' });
        // }

        // const existingQuestion = await Question.findOne({ where: { /*phases_id, */ text } });
        // if (existingQuestion) {
        //     return res.status(400).json({ status: 'error', message: 'Question already exists for this phase' });
        // }

        const question = await Question.create(req.body);
        res.status(201).json({ status: 'success', data: question });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Update
router.put('/questions/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const question = await Question.findByPk(id);
        if (!question) {
            return res.status(404).json({ status: 'error', message: 'Question not found' });
        }
        await question.update(req.body);
        res.json({ status: 'success', data: question });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Delete
router.delete('/questions/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const question = await Question.findByPk(id);
        if (!question) {
            return res.status(404).json({ status: 'error', message: 'Question not found' });
        }
        await question.destroy();
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

//one question:
router.get('/questions/:phaseId', async (req, res) => {
    const { phaseId } = req.params
    try {
        const existingQuestionPhase = await Question.findOne({ where: { phases_id: phaseId} });
        
        if(!existingQuestionPhase) {
          return res.status(400).json({ status: 'error', message: "Not Phase in the Question" });
        }
        res.status(201).json({ status: 'success', data: existingQuestionPhase });
      } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
      }
    
});

router.post('/questions/design', async (req, res) => {
    const { text, content, additional_info, type, session_id, number } = req.body;
    let boolQuestionNumber = false;

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
        //console.log(design.dataValues.design.phases)
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

router.post('/questions/:id/responses', async (req, res) => {

});

router.put('/questions/:id/responses', async (req, res) => {

});

router.get('/questions/:id/responses', async (req, res) => {

});
module.exports = router;
