module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('activityUserRoles', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      RoleId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'activityRoles', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      activityId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'activities', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    // Index for quick lookups
    await queryInterface.addIndex('activityUserRoles', ['userId']);
    await queryInterface.addIndex('activityUserRoles', ['RoleId']);
    await queryInterface.addIndex('activityUserRoles', ['activityId']);
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('activityUserRoles');
  }
};
