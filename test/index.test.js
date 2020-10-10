/*! copyright gerd forstmann, all rights reserved */
//var debug = require('debug')('appdata.nunit');
var process = require('process');
var root = (process.env.FSD_COVERAGE) ? '../gen_cov' : '../js';

//var fs = require('fs');

//var debuglog = require('debugf')('test.mongoose_record_replay.nunit.js');

var MongoMock = require(root + '/mgrecrep.js');

/**
 * clear a cache for the defaut mode for coverage
 */
/*
try {
  fs.unlinkSync('./node_modules/mgnlq_testmodel/testmodel/_cachefalse.js.zip');
} catch (e) {
  // empty
}

try {
  fs.unlinkSync('./testmodel/_cachetrue.js.zip');
} catch (e) {
  // empty
}
*/

it('testDigestPlatformNeutral', done => {

  var res = MongoMock.digestArgs('abc','def', { a : /^abc/i, b : [1,2,'3'] } );
  expect(res).toEqual('896d5e71371a58f430b6bbe7fb9079b7');
  done();
});

it('testDeser', done => {
  var ser = MongoMock.JSONStringify({ a: /abc/g, c: 1 });
  var r = MongoMock.JSONParse(ser);
  expect(r.a instanceof RegExp).toEqual(true);
  expect(r.a.toString()).toEqual('/abc/g');
  done();
});

it('testPlainMongo', done => {
  var mymock = {};
  var res = MongoMock.instrumentMongoose(mymock, 'path1', undefined);
  expect(res).toEqual(mymock);
  done();
});

it('testOpenConnection', done => {
  var mymock = {};
  expect.assertions(1);
  var res = MongoMock.instrumentMongoose(mymock, 'path1/', 'REPLAY');
  res.connect('dummyconn');
  res.connection.once('open', function () {
    expect(1).toEqual(1);
    done();
  });
});

it('testOpenConnectionAndFind', done => {
  var mymock = {};
  expect.assertions(1);
  var mongooseM = MongoMock.instrumentMongoose(mymock, 'test/data/', 'REPLAY');
  mongooseM.connect('dummyconn');
  mongooseM.connection.once('open', function () {
    var model = mongooseM.model('abc', { a: 'schema' });
    model.find({}).lean().exec().then((res) => {

      expect(res).toEqual([{ a: 1 }, { a: 2 }]);
      mongooseM.disconnect();
      done();
    });
  });
});



it('testOpenConnectionAndFindNotPresent', done => {
  var mymock = {};
  expect.assertions(1);
  var mongooseM = MongoMock.instrumentMongoose(mymock, 'test/data/', 'REPLAY');
  mongooseM.connect('dummyconn');
  mongooseM.connection.once('open', function () {
    var model = mongooseM.model('abc', { a: 'schema' });
    try {
      model.find({ 'a': 1 }).lean().exec().then((res) => {
        expect(1).toEqual(0);
        mongooseM.disconnect();
        done();
      });
    }
    catch (e) {
      expect(1).toEqual(1);
      mongooseM.disconnect();
      done();
    }
  });
});
