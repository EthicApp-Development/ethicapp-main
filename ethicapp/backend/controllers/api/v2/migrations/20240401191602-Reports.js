'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('report_activity', {
      creation_date: {
        type: Sequelize.DATE,
        primaryKey: true
      },
      professor: {
        type: Sequelize.INTEGER,
        primaryKey: true
      },
      count: {
        type: Sequelize.INTEGER
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
    await queryInterface.createTable('report_create_account', {
      creation_date: {
        type: Sequelize.DATE,
        primaryKey: true
      },
      is_teacher: {
        type: Sequelize.BOOLEAN,
        primaryKey: true
      },
      count: {
        type: Sequelize.INTEGER
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
    await queryInterface.createTable('report_login', {
      login_date: {
        type: Sequelize.DATE,
        primaryKey: true
      },
      is_teacher: {
        type: Sequelize.BOOLEAN,
        primaryKey: true
      },
      count: {
        type: Sequelize.INTEGER
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
    await queryInterface.createTable('report_type', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      report_type: {
        type: Sequelize.TEXT
      },
      report_description: {
        type: Sequelize.TEXT
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
    await queryInterface.sequelize.query(`
    CREATE OR REPLACE FUNCTION UpdateOrInsertLoginRecord(isProfessorPointer int) RETURNS void AS $$
    DECLARE
      currentDate date;
      currentCount int;
    BEGIN
      currentDate := current_date; -- Get the current date

      -- Check if a row with the current date exists
      SELECT INTO currentCount count FROM report_login WHERE login_date = currentDate AND is_teacher = (isProfessorPointer::bit);

      IF currentCount IS NULL THEN
          -- If no row exists, insert a new row with counter initialized to 1
          INSERT INTO report_login (login_date, is_teacher, count) VALUES (currentDate, isProfessorPointer::bit, 1);
      ELSE
          -- If a row exists, increment the counter and update the row
          UPDATE report_login SET count = currentCount + 1 WHERE login_date = currentDate AND is_teacher = (isProfessorPointer::bit);
      END IF;
    END;
    $$ LANGUAGE plpgsql;
    `);
    await queryInterface.sequelize.query(`
    CREATE OR REPLACE FUNCTION UpdateOrInsertCreateAccountRecord(isProfessorPointer int) RETURNS void AS $$
    DECLARE
      currentDate date;
      currentCount int;
    BEGIN
      currentDate := current_date; -- Get the current date

      -- Check if a row with the current date exists
      SELECT INTO currentCount count FROM report_create_account WHERE creation_date = currentDate AND is_teacher= (isProfessorPointer::bit);

      IF currentCount IS NULL THEN
          -- If no row exists, insert a new row with counter initialized to 1
          INSERT INTO report_create_account (creation_date, is_teacher, count) VALUES (currentDate, isProfessorPointer::bit, 1);
      ELSE
          -- If a row exists, increment the counter and update the row
          UPDATE report_create_account SET count = currentCount + 1 WHERE creation_date = currentDate AND is_teacher = (isProfessorPointer::bit);
      END IF;
    END;
    $$ LANGUAGE plpgsql;
    `);
    await queryInterface.sequelize.query(`
    CREATE OR REPLACE FUNCTION UpdateOrInsertActivityRecord(professor_id int) RETURNS void AS $$
    DECLARE
      currentDate date;
      current_count int;
    BEGIN
      currentDate := current_date; -- Get the current date

      -- Check if a row with the given professor_id and current_date exists
      SELECT INTO current_count count
      FROM report_activity
      WHERE creation_date = currentDate AND professor = professor_id;

      IF current_count IS NULL THEN
          -- If no row exists, insert a new row with counter initialized to 1
          INSERT INTO report_activity (creation_date, professor, count)
          VALUES (currentDate, professor_id, 1);
      ELSE
          -- If a row exists, increment the counter and update the row
          UPDATE report_activity
          SET count = current_count + 1
          WHERE creation_date = currentDate AND professor = professor_id;
      END IF;
    END;
    $$ LANGUAGE plpgsql;
    `);
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('DROP FUNCTION IF EXISTS UpdateOrInsertLoginRecord(int)');
    await queryInterface.sequelize.query('DROP FUNCTION IF EXISTS UpdateOrInsertCreateAccountRecord(int)');
    await queryInterface.sequelize.query('DROP FUNCTION IF EXISTS UpdateOrInsertActivityRecord(int)');
    await queryInterface.dropAllTables();
  }
};