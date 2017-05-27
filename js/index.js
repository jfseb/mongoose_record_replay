/**
 * instrument mongoose to replay queries ( !! only queries so far)
 *
 *
 * @file
 */
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//import * as intf from 'constants';
const debugf = require("debugf");
var debuglog = debugf('mongoose_record_replay');
//const loadlog = logger.logger('modelload', '');
const process = require("process");
const mongoose = require("mongoose");
const events = require("events");
var recordingPath = 'mongoose_record_replay/';
var serializePath = 'mgrecrep/';
var theMode = undefined;
function readFileAsJSON(filename) {
    var data = fs.readFileSync(filename, 'utf-8');
    try {
        return JSON.parse(data);
    }
    catch (e) {
        console.log("Content of file " + filename + " is no json" + e);
        process.exit(-1);
    }
    return undefined;
}
function assurePath(path) {
    try {
        fs.mkdirSync(path);
    }
    catch (e) {
    }
    try {
        fs.mkdirSync(path + 'data');
    }
    catch (e) {
    }
}
var dbEmitter = new events.EventEmitter();
dbEmitter.setMaxListeners(0);
const fs = require("fs");
function instrumentModel(model) {
    if (theMode === "RECORD") {
        instrumentModelRecord(model);
    }
    else if (theMode === "REPLAY") {
        // todo
        instrumentModelReplay(model);
    }
    return model;
}
exports.instrumentModel = instrumentModel;
var crypto = require('crypto');
function makeFileName(digest) {
    return (recordingPath + 'data/' + digest + '.json');
}
function recordOp(op, name, query, res) {
    var md5sum = crypto.createHash('md5');
    debuglog('here the name ' + name);
    md5sum.update(op + name + JSON.stringify(query));
    var digest = md5sum.digest('hex');
    fs.writeFileSync(makeFileName(digest), JSON.stringify(res, undefined, 2));
    var known = {};
    try {
        known = readFileAsJSON(recordingPath + 'queries.json');
    }
    catch (ex) {
    }
    known[digest] = { op: op,
        name: name,
        digest: digest,
        query: query,
        res: res };
    fs.writeFileSync(recordingPath + 'queries.json', JSON.stringify(known, undefined, 2));
}
exports.recordOp = recordOp;
function retrieveOp(op, name, query) {
    var md5sum = crypto.createHash('md5');
    md5sum.update(op + name + JSON.stringify(query));
    var digest = md5sum.digest('hex');
    var filename = makeFileName(digest);
    debuglog(' filename ' + filename);
    var res = readFileAsJSON(filename);
    if (res === undefined) {
        debuglog('empty result for query ' + op + ' ' + JSON.stringify(query, undefined, 2) + '\n' + filename);
    }
    return res;
}
exports.retrieveOp = retrieveOp;
function instrumentModelRecord(modelDoc) {
    console.log('instrumenting model ' + modelDoc.modelName);
    var oFind = modelDoc.find;
    modelDoc.find = function () {
        debuglog('someone is calling find with ' + modelDoc.modelName + JSON.stringify(arguments, undefined, 2));
        var res = oFind.apply(modelDoc, arguments);
        if (arguments.length !== 1) {
            throw Error('expected one arguments in find, was ' + arguments.length);
        }
        var query = arguments[0];
        res.lean().exec().then((a) => {
            //console.log("here result1 + " + JSON.stringify(a, undefined,2) );
            recordOp("find", modelDoc.modelName, query, a);
        });
        return res;
    };
    var oDistinct = modelDoc.distinct;
    modelDoc.distinct = function () {
        debuglog('someone is calling distinct with' + JSON.stringify(arguments, undefined, 2));
        var res = oDistinct.apply(modelDoc, arguments);
        if (arguments.length !== 1) {
            throw Error('expected on arguments');
        }
        var query = arguments[0];
        res.then((a) => {
            // console.log("here result1 + " + JSON.stringify(a, undefined,2) );
            recordOp("distinct", modelDoc.modelName, query, a);
        });
        return res;
    };
    var oAggregate = modelDoc.aggregate;
    modelDoc.aggregate = function () {
        debuglog(() => 'someone is calling aggregate with' + JSON.stringify(arguments, undefined, 2));
        var query = Array.prototype.slice.call(arguments);
        var res = oAggregate.apply(modelDoc, arguments);
        res.then((a) => {
            debuglog(() => "here result1 + " + JSON.stringify(a, undefined, 2));
            recordOp("aggregate", modelDoc.modelName, query, a);
        });
        return res;
    };
}
exports.instrumentModelRecord = instrumentModelRecord;
function instrumentModelReplay(modelDoc) {
    debuglog('instrumenting model ' + modelDoc.modelName);
    var oFind = modelDoc.find;
    modelDoc.find = function () {
        debuglog(() => 'someone is replaying find with' + JSON.stringify(arguments, undefined, 2));
        var query = arguments[0];
        var res = retrieveOp("find", modelDoc.modelName, query);
        debuglog(() => 'returning res ' + JSON.stringify(res) + ' for query find' + query);
        return {
            lean: function () {
                return {
                    exec: function () {
                        return new Promise(function (resolve, reject) {
                            setTimeout(function () {
                                resolve(res);
                            }, 0);
                        });
                    }
                };
            }
        };
    };
    var oDistinct = modelDoc.distinct;
    modelDoc.distinct = function () {
        debuglog('someone is replaying distinct with' + JSON.stringify(arguments, undefined, 2));
        var query = arguments[0];
        var res = retrieveOp("distinct", modelDoc.modelName, query);
        debuglog('returning res ' + JSON.stringify(res) + ' for query find' + query);
        return new Promise(function (resolve, reject) {
            setTimeout(function () { resolve(res); }, 0);
        });
    };
    var oAggregate = modelDoc.aggregate;
    modelDoc.aggregate = function () {
        debuglog('someone is replaying aggregate with' + JSON.stringify(arguments, undefined, 2));
        var query = Array.prototype.slice.call(arguments);
        var res = retrieveOp("aggregate", modelDoc.modelName, query);
        var p = new Promise(function (resolve, reject) {
            setTimeout(function () { resolve(res); }, 0);
        });
        p.exec = function () {
            return p;
        };
        return p;
    };
}
exports.instrumentModelReplay = instrumentModelReplay;
function instrumentMongoose(mongoose, path, mode) {
    theMode = mode || process.env.MONGO_RECORD_REPLAY;
    if (mode && ["REPLAY", "RECORD"].indexOf(mode) < 0) {
        console.log('set only one of MONGO_RECORD MONGO_REPLAY');
        throw new Error('mongoose_record_replay mode should be one of "REPLAY", "RECORD"  was ' + theMode);
    }
    if (theMode === "RECORD") {
        recordingPath = path || process.env.MONGO_RECORD_REPLAY_PATH || "mongoose_record_replay";
        assurePath(recordingPath);
        var omodel = mongoose.model;
        mongoose.model = function () {
            if (arguments.length > 1) {
                return instrumentModel(omodel.apply(mongoose, arguments));
            }
            return omodel.apply(mongoose, arguments);
        };
        return mongoose;
    }
    else if (theMode === "REPLAY") {
        recordingPath = path || process.env.MONGO_RECORD_REPLAY_PATH || "mongoose_record_replay";
        return exports.mongooseMock;
    }
    return mongoose;
}
exports.instrumentMongoose = instrumentMongoose;
exports.mongooseMock = {
    models: {},
    modelNames: function () {
        return Object.keys(this.models);
    },
    Schema: mongoose.Schema,
    model: function (a, b) {
        if (b === undefined) {
            return this.models[a];
        }
        debuglog('creating model  ' + a + ' at mock');
        this.models[a] = instrumentModel({
            find: function () { },
            aggregate: function () { },
            distinct: function () { },
            modelName: a,
            schema: b,
        });
        return this.models[a];
    },
    disconnect: function () {
        debuglog('simulationg disconnect ');
    },
    connect: function (connStr) {
        // this.db.on.emit('on');
        debuglog('simulationg connecting to ' + connStr);
        if (!this._once) {
            var that = this;
            setTimeout(function () {
                that.connection.emit('open');
                debuglog('fired emit');
            }, 0);
        }
    },
    connection: dbEmitter
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7O0dBS0c7OztBQUVILG9DQUFvQztBQUNwQyxpQ0FBaUM7QUFFakMsSUFBSSxRQUFRLEdBQUcsTUFBTSxDQUFDLHdCQUF3QixDQUFDLENBQUM7QUFDaEQsaURBQWlEO0FBRWpELG1DQUFtQztBQUNuQyxxQ0FBcUM7QUFDckMsaUNBQWlDO0FBRWpDLElBQUksYUFBYSxHQUFHLHlCQUF5QixDQUFDO0FBRTlDLElBQUksYUFBYSxHQUFHLFdBQVcsQ0FBQztBQUVoQyxJQUFJLE9BQU8sR0FBRyxTQUFTLENBQUM7QUFHeEIsd0JBQXdCLFFBQWdCO0lBQ3BDLElBQUksSUFBSSxHQUFHLEVBQUUsQ0FBQyxZQUFZLENBQUMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQzlDLElBQUksQ0FBQztRQUNELE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzVCLENBQUM7SUFBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ1QsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsR0FBRyxRQUFRLEdBQUcsYUFBYSxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQy9ELE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNyQixDQUFDO0lBQ0QsTUFBTSxDQUFDLFNBQVMsQ0FBQztBQUNyQixDQUFDO0FBR0Qsb0JBQW9CLElBQWE7SUFDN0IsSUFBSSxDQUFDO1FBQ0QsRUFBRSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUV2QixDQUFDO0lBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUViLENBQUM7SUFDRCxJQUFJLENBQUM7UUFDRCxFQUFFLENBQUMsU0FBUyxDQUFDLElBQUksR0FBRyxNQUFNLENBQUMsQ0FB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