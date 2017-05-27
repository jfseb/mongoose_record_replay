/**
 * instrument mongoose to replay queries ( !! only queries so far)
 *
 *
 * @file
 */

//import * as intf from 'constants';
import * as debugf from 'debugf';

var debuglog = debugf('mongoose_record_replay');
//const loadlog = logger.logger('modelload', '');

import * as process from 'process';
import * as mongoose from 'mongoose';
import * as events from 'events';

var recordingPath = 'mongoose_record_replay/';

var serializePath = 'mgrecrep/';


function readFileAsJSON(filename: string): any {
    var data = fs.readFileSync(filename, 'utf-8');
    try {
        return JSON.parse(data);
    } catch (e) {
        console.log("Content of file " + filename + " is no json" + e);
        process.exit(-1);
    }
    return undefined;
}


function assurePath(path : string) {
    try {
        fs.mkdirSync(path);

    } catch (e) {

    }
    try {
        fs.mkdirSync(path + 'data');
    } catch(e) {

    }
}

var dbEmitter = new events.EventEmitter();
dbEmitter.setMaxListeners(0);

import * as fs from 'fs';

export function instrumentModel(model : mongoose.Model<any>) {
    if(process.env.MONGO_RECORD && process.env.MONGO_REPLAY) {
        console.log('set only one of MONGO_RECORD MONGO_REPLAY');
        process.exit(-1);
    }
    if (process.env.MONGO_RECORD) {
        instrumentModelRecord(model);
    } else if (process.env.MONGO_REPLAY) {
        // todo
        instrumentModelReplay(model);
    }
    return model;
}

var crypto = require('crypto');

function makeFileName(digest) {
   return (recordingPath + 'data/' + digest + '.json');
}

export function recordOp(op : string, name : string, query : any, res : any) {
    var md5sum = crypto.createHash('md5');
    debuglog('here the name ' + name);
    md5sum.update(op + name + JSON.stringify(query));
    var digest = md5sum.digest('hex');
    fs.writeFileSync(makeFileName(digest), JSON.stringify(res,undefined,2));

    var known = {};
    try {
        known = readFileAsJSON(recordingPath + 'queries.json');
    } catch(ex) {

    }
    known[digest] = { op : op,
                name : name,
                digest : digest,
                query : query,
            res : res};
    fs.writeFileSync(recordingPath + 'queries.json',JSON.stringify(known,undefined,2));
}

export function retrieveOp(op : string, name : string, query : any) {
    var md5sum = crypto.createHash('md5');
    md5sum.update(op + name + JSON.stringify(query));
    var digest = md5sum.digest('hex');
    var filename = makeFileName(digest);
    debuglog(' filename ' + filename);
    var res = readFileAsJSON(filename);
    return res;
}

export function instrumentModelRecord(modelDoc : mongoose.Model<any>) {
    console.log('instrumenting model ' + modelDoc.modelName);
    var oFind = modelDoc.find;
    modelDoc.find = function() : any {
        debuglog('someone is calling find with ' + modelDoc.modelName   + JSON.stringify(arguments,undefined,2));
        var res = oFind.apply(modelDoc, arguments);
        if(arguments.length !== 1) {
            throw Error('expected one arguments in find, was ' + arguments.length);
        }
        var query = arguments[0];
        res.lean().exec().then( (a) => {
            //console.log("here result1 + " + JSON.stringify(a, undefined,2) );
            recordOp("find",modelDoc.modelName, query, a);
        }
        );
        return res;
    }
     var oDistinct = modelDoc.distinct;
    modelDoc.distinct = function() : any {
        debuglog('someone is calling distinct with'  + JSON.stringify(arguments,undefined,2));
        var res = oDistinct.apply(modelDoc, arguments);
        if(arguments.length !== 1) {
            throw Error('expected on arguments');
        }
        var query = arguments[0];
        res.then( (a) => {
           // console.log("here result1 + " + JSON.stringify(a, undefined,2) );
            recordOp("distinct",modelDoc.modelName, query, a);
        }
        );
        return res;
    }
     var oAggregate = modelDoc.aggregate;
     modelDoc.aggregate = function() : any {
        debuglog(() => 'someone is calling aggregate with'  + JSON.stringify(arguments,undefined,2));
        var query = Array.prototype.slice.call(arguments);
        var res = oAggregate.apply(modelDoc, arguments);
        res.then( (a) => {
           debuglog(() =>"here result1 + " + JSON.stringify(a, undefined,2) );
            recordOp("aggregate",modelDoc.modelName, query, a);
        }
        );
        return res;
    }
}

export function instrumentModelReplay(modelDoc : mongoose.Model<any>) {
    debuglog('instrumenting model ' + modelDoc.modelName);
    var oFind = modelDoc.find;
    modelDoc.find = function() : any {
        debuglog(() => 'someone is replaying find with'  + JSON.stringify(arguments,undefined,2));
        var query = arguments[0];
        var res = retrieveOp("find",modelDoc.modelName, query);
        debuglog( ()=> 'returning res ' + JSON.stringify(res) + ' for query find' + query);
        return {
            lean : function() {
                return {
                    exec : function() {
                        return new Promise(function(resolve, reject) {
                            setTimeout(function() {
                                resolve(res); },0);
                        });
                    }
                }
            }
        }
    }
    var oDistinct = modelDoc.distinct;
    modelDoc.distinct = function() : any {
        debuglog('someone is replaying distinct with'  + JSON.stringify(arguments,undefined,2));
        var query = arguments[0];
        var res = retrieveOp("distinct",modelDoc.modelName, query);
        debuglog('returning res ' + JSON.stringify(res) + ' for query find' + query);
        return new Promise(function(resolve, reject) {
                            setTimeout(function() { resolve(res); },0);
                        });
    }
     var oAggregate = modelDoc.aggregate;
     modelDoc.aggregate = function() : any {
        debuglog('someone is replaying aggregate with'  + JSON.stringify(arguments,undefined,2));
        var query = Array.prototype.slice.call(arguments);
        var res = retrieveOp("aggregate",modelDoc.modelName, query);
        var p = new Promise(function(resolve, reject) {
                            setTimeout(function() { resolve(res); },0);
                        });
        (p as any).exec = function() {
            return p;
        }
        return p;
    }
}

export function instrumentMongoose(mongoose: mongoose.Mongoose, path? : string, mode? : string) : mongoose.Mongoose {
     var themode = mode || process.env.MONGO_RECORD_REPLAY;
     if(mode && ["REPLAY","RECORD"].indexOf(mode) < 0) {
        console.log('set only one of MONGO_RECORD MONGO_REPLAY');
        throw new Error('mongoose_record_replay mode should be one of "REPLAY", "RECORD"  was ' + themode);
    }
    if (themode === "RECORD") {
        recordingPath = path || process.env.MONGO_RECORD_REPLAY_PATH || "mongoose_record_replay";
        assurePath(recordingPath);
        var omodel = mongoose.model;
        mongoose.model = function() {
            if(arguments.length > 1) {
                return instrumentModel(omodel.apply(mongoose, arguments));
            }
            return omodel.apply(mongoose, arguments);
        }
        return mongoose;
    } else if (themode === "REPLAY") {
        recordingPath = path || process.env.MONGO_RECORD_REPLAY_PATH || "mongoose_record_replay";
        return mongooseMock as any;
    }
    return mongoose;
}


export var mongooseMock = {
    models : {},
    modelNames : function() {
        return Object.keys(this.models);
    },
    Schema : mongoose.Schema,

    model : function(a,b) {
        if(b === undefined) {
            return this.models[a];
        }
        debuglog('createing model '+ a);
        this.models[a] = instrumentModel({
            find : function() {},
            aggregate : function() {},
            distinct : function() {},
            modelName : a,
            schema : b,
        } as any);
        return this.models[a];
    },
    disconnect : function() {
        debuglog('simulationg disconnect ');
    },
    connect : function(connStr : string) {
       // this.db.on.emit('on');
       debuglog('simulationg connecting to ' + connStr);
        if(!this._once) {
            var that = this;
            setTimeout(function() {
                that.connection.emit('open');
                debuglog('fired emit');
            },0);
        }
    },
    connection : dbEmitter
};
