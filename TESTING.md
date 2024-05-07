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
