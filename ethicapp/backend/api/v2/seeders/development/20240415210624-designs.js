'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('designs', [
      {
        creator: 1,
        design: JSON.stringify({ 
          title: 'Design 1', 
          description: 'This is the first design', 
          elements: [{ type: 'rectangle', color: 'red', width: 100, height: 50, x: 10, y: 10 }] 
        }),
        public: true,
        locked: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        question_id: 2
      },
      {
        creator: 2,
        design: JSON.stringify({ 
          title: 'Design 2', 
          description: 'This is the second design', 
          elements: [{ type: 'circle', color: 'blue', radius: 50, x: 50, y: 50 }] 
        }),
        public: false,
        locked: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        question_id: 1
      },
      {
        creator: 3,
        design: JSON.stringify({ 
          title: 'Design 3', 
          description: 'This is the third design', 
          elements: [{ type: 'triangle', color: 'green', sideLength: 80, x: 30, y: 30 }] 
        }),
        public: true,
        locked: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        question_id: 3
      },
      {
        creator: 1,
        design: JSON.stringify({ 
          title: 'Design 4', 
          description: 'This is the fourth design', 
          elements: [{ type: 'ellipse', color: 'yellow', rx: 60, ry: 30, x: 70, y: 70 }] 
        }),
        public: false,
        locked: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        question_id: 1
      },
      {
        creator: 2,
        design: JSON.stringify({ 
          title: 'Design 5', 
          description: 'This is the fifth design', 
          elements: [{ type: 'line', color: 'black', x1: 10, y1: 10, x2: 100, y2: 100 }] 
        }),
        public: true,
        locked: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        question_id: 2
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('designs', null, {});
  }
};
