const { Session } = require('../models');

const authorizeSessionAccess = async (req, res, next) => {
  const { sessionId } = req.params;
  const user = req.user;

  //console.log(`User: ${user.id}, Role: ${user.role}, Session: ${sessionId}`);

  if (user.role === 'A') {
    return next();
  }

  if (user.role === 'P') {
    try {
      const session = await Session.findByPk(sessionId);
      if (session && session.creator === user.id) {
        return next();
      } else {
        //console.log('Access forbidden: not the creator');
        return res.status(403).json({ status: 'error', message: 'Access forbidden: not the creator' });
      }
    } catch (err) {
      //console.error('Error fetching session:', err);
      return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  }

  //console.log('Access forbidden: insufficient permissions');
  return res.status(403).json({ status: 'error', message: 'Access forbidden: insufficient permissions' });
};

module.exports = authorizeSessionAccess;
