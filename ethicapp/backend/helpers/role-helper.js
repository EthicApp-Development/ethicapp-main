// helpers/role-helper.js

/**
 * Distribuye usuarios en roles por round-robin.
 * @param {Array<{ name: string, description: string }>} roleDefs
 * @param {number[]} userIds
 * @returns {Array<{ roleName: string, userId: number }>}
 */
function assignRoles(roleDefs, userIds) {
    const assignments = [];
    if (!roleDefs.length || !userIds.length) return assignments;
  
    let idx = 0;
    for (const userId of userIds) {
      const roleName = roleDefs[idx].name;
      assignments.push({ roleName, userId });
      idx = (idx + 1) % roleDefs.length;
    }
  
    return assignments;
  }
  
  module.exports = { assignRoles };
  
  