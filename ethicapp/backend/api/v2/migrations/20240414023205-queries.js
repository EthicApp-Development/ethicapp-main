'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
    CREATE OR REPLACE FUNCTION UpdateOrInsertLoginRecord(isProfessorPointer int) RETURNS void AS $$
    DECLARE
      currentDate date;
      currentCount int;
    BEGIN
      currentDate := current_date; -- Get the current date

      -- Check if a row with the current date exists
      SELECT INTO currentCount count FROM login_reports WHERE login_date = currentDate AND is_teacher = (isProfessorPointer::bit);

      IF currentCount IS NULL THEN
          -- If no row exists, insert a new row with counter initialized to 1
          INSERT INTO login_reports (login_date, is_teacher, count) VALUES (currentDate, isProfessorPointer::bit, 1);
      ELSE
          -- If a row exists, increment the counter and update the row
          UPDATE login_reports SET count = currentCount + 1 WHERE login_date = currentDate AND is_teacher = (isProfessorPointer::bit);
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
      SELECT INTO currentCount count FROM account_creation_reports WHERE creation_date = currentDate AND is_teacher= (isProfessorPointer::bit);

      IF currentCount IS NULL THEN
          -- If no row exists, insert a new row with counter initialized to 1
          INSERT INTO account_creation_reports (creation_date, is_teacher, count) VALUES (currentDate, isProfessorPointer::bit, 1);
      ELSE
          -- If a row exists, increment the counter and update the row
          UPDATE account_creation_reports SET count = currentCount + 1 WHERE creation_date = currentDate AND is_teacher = (isProfessorPointer::bit);
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
      FROM activity_reports
      WHERE creation_date = currentDate AND professor = professor_id;

      IF current_count IS NULL THEN
          -- If no row exists, insert a new row with counter initialized to 1
          INSERT INTO activity_reports (creation_date, professor, count)
          VALUES (currentDate, professor_id, 1);
      ELSE
          -- If a row exists, increment the counter and update the row
          UPDATE activity_reports
          SET count = current_count + 1
          WHERE creation_date = currentDate AND professor = professor_id;
      END IF;
    END;
    $$ LANGUAGE plpgsql;
    `);
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.sequelize.query('DROP FUNCTION IF EXISTS UpdateOrInsertLoginRecord(int)');
    await queryInterface.sequelize.query('DROP FUNCTION IF EXISTS UpdateOrInsertCreateAccountRecord(int)');
    await queryInterface.sequelize.query('DROP FUNCTION IF EXISTS UpdateOrInsertActivityRecord(int)');
    await queryInterface.dropAllTables();
  }
};
