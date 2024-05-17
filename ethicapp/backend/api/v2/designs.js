const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();

// Import Model
const { Design } = require('../../api/v2/models');

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

module.exports = router;
