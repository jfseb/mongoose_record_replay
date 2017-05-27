/*! copyright gerd forstmann, all rights reserved */
//var debug = require('debug')('appdata.nunit');
var process = require('process');
var root = (process.env.FSD_COVERAGE) ? '../gen_cov' : '../js';

//var fs = require('fs');

//var debuglog = require('debugf')('test.mongoose_record_replay.nunit.js');

var MongoMock = require(root + '/index.js');

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

exports.testPlainMongo = function(test) {
  var mymock = {};
  var res = MongoMock.instrumentMongoose(mymock,'path1',undefined);
  test.equal(res,mymock);
  test.done();
};

exports.testOpenConnection = function(test) {
  var mymock = {};
  test.expect(1);
  var res = MongoMock.instrumentMongoose(mymock,'path1/','REPLAY');
  res.connect('dummyconn');
  res.connection.once('open', function() {
    test.equal(1,1);
    test.done();
  });
};

exports.testOpenConnectionAndFind = function(test) {
  var mymock = {};
  test.expect(1);
  var mongooseM = MongoMock.instrumentMongoose(mymock,'test/data/','REPLAY');
  mongooseM.connect('dummyconn');
  mongooseM.connection.once('open', function() {
    var model = mongooseM.model('abc', { a : 'schema'});
    model.find({}).lean().exec().then((res) => {
      test.deepEqual(res,[ { a: 1}, { a: 2}]);
      mongooseM.disconnect();
      test.done();
    });
  });
};
