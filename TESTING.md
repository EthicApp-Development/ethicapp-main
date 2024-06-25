# EthicApp Testing api's

## *[Jest](https://jestjs.io/es-ES/)* was used.
## the library _[Supertest](https://www.npmjs.com/package/supertest)_ was used for test handling with https.
The folder structure is as follows:

- tests/
  - unit/
    - user.test.js
    - product.test.js
  - integration/
    - api.test.js
  - fixtures/
    - users.json
    - products.json

there will be a test folder where there are 3 other folders:
- *unit*: is for unit testing, the name of the files inside is:  <_nameFile_>.test.js
- *integration*:  is to make tests that mix several other files and/or communicate constantly. The name of this files is: <_nameFile1-nameFile2_>.test.js
- *fixtures*: are json files, they contain data so that they can be used in unit and integration, the name for this files is: <_nameFile_>.json

### other option for to generate test data programmatically, is to use the Factory Girl or Faker.js library. This allows you to create data dynamically and customised to your testing needs.

to test the tests, you need to go to the ethicapp [ `/ethicapp-main/ethicapp/backend `] folder and in a terminal run the following command: `npm test`

jest can also make a table in which you can check in more detail how the quality of the tests was. to be able to see it you have to go where the `npx jest --detectOpenHandles` tests are called and add the following argument: `--coverage`. which is in the following file: `ethicapp/backend/api/v2/test/repeat-test.sh` line 6

the columns that appear are as follows:
* File: which would be the name and location of the file.
* %Stmts: This is the percentage of all executable statements in the code that have been executed during testing. It measures how many individual statements have been covered by the tests.
* %Branch: This is the percentage of all decision branches (conditional if, else, switch, case, etc.) that have been executed. It measures how many decision branches in the code have been covered by the tests. This metric is important to ensure that all possible paths through the code are tested.
* %Funcs: This is the percentage of all functions defined in the code that have been called during testing. It measures how many functions have been covered by the tests.
* %Lines: Is the percentage of all lines of code that have been executed during testing. It measures how many lines of code have been covered by the tests. It is similar to %Stmts, but may differ in some cases depending on how statements and lines are counted.
* Uncovered Line #s: Lists the numbers of lines that have not been executed during testing. It indicates specifically which lines in the file were not covered by the tests, providing clear guidance on where to focus to improve coverage.

if the above command does not work, try using the following command: `npm install`
