const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();

// Import Model
const { Response } = require('../../api/v2/models');

// Configure body-parser to process the body of requests in JSON format.

router.use(bodyParser.json());

// Read
router.get('/responses', async (req, res) => {
    try {
      const responses = await Response.findAll();
      res.status(200).json({ status: 'success', data: responses });
    } catch (err) {
      console.error(err);
      res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Create
router.post('/responses', async (req, res) => {
    try {
      const response = await Response.create(req.body);
      res.status(201).json({ status: 'success', data: response });
    } catch (err) {
      console.error(err);
      res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Update
router.put('/responses/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const response = await Response.findByPk(id);
      if (!response) {
        return res.status(404).json({ status: 'error', message: 'Response not found' });
      }
      await response.update(req.body);
      res.json({ status: 'success', data: response });
    } catch (err) {
      console.error(err);
      res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Delete
router.delete('/responses/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const response = await Response.findByPk(id);
      if (!response) {
        return res.status(404).json({ status: 'error', message: 'Response not found' });
      }
      await response.destroy();
      res.status(204).end();
    } catch (err) {
      console.error(err);
      res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

module.exports = router;
