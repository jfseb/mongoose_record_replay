/**
 * instrument mongoose to record/replay queries (!! only queries so far)
 *
 * allows to run (mongoose read only) unit tests w.o. a mongoose instance
 *
 * @file
 */

import * as debugf from 'debugf';

var debuglog = debugf('mongoose_record_replay');

const path = require('path');
import * as process from 'process';
import * as mongoose from 'mongoose';
import * as events from 'events';
import * as fs from 'fs';
const crypto = require('crypto');

/**
 * The recording path, set via argument
 * or
 */
export function JSONParse(text: string): any {
    function customDeSer(key, value) {
        if (value.toString().indexOf("__REGEXP ") == 0) {
            var m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
            return new RegExp(m[1], m[2] || "");
        } else
            return value;
    }
    return JSON.parse(text, customDeSer);
}

export function JSONStringify(obj: any): string {
    function customSer(key, value) {
        if (value instanceof RegExp){
            return ("__REGEXP " + value.toString());
        }
        else
            return value;
    }
    return JSON.stringify(obj, customSer, 2);
}

function readFileAsJSON(filename: string): any {
    try {
        var data = fs.readFileSync(filename, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        console.log("Content of file " + filename + " is no json" + e);
        throw new Error("Content of file " + filename + " is no json" + e);
    }
    return undefined;
}


function assurePath(path: string) {
    try {
        fs.mkdirSync(path);
    } catch (e) {

    }
    try {
        fs.mkdirSync(path + 'data');
    } catch (e) {

    }
}

var dbEmitter = new events.EventEmitter();
// unit test invoke this multiple times, avoid node js warning
dbEmitter.setMaxListeners(0);

export function instrumentModel(model: mongoose.Model<any>, recordingPath : string, theMode: string) {
    if (theMode === "RECORD") {
        instrumentModelRecord(model, recordingPath, theMode);
    } else if (theMode === "REPLAY") {
        // todo
        instrumentModelReplay(model, recordingPath);
    }
    return model;
}


function makeFileName(digest, recordingPath: string) {
    return (recordingPath + 'data/' + digest + '.json');
}

export function digestArgs(op: string, name : string, query : any) {
    var md5sum = crypto.createHash('md5');
    debuglog('here the name ' + name);
    md5sum.update(op + name + JSONStringify(query));
    var digest = '' + md5sum.digest('hex');
    return digest;
}

export function recordOp(op: string, name: string, query: any, res: any, recordingPath : string) {
    var digest = digestArgs(op,name,query);
    var resStr = JSON.stringify(res, undefined, 2);
    var len = 0;
    if(res && Array.isArray(res)) {
        len = res.length;
    } else {
        len = resStr.length;
    }
    var filename = makeFileName(digest, recordingPath);
    console.log( 'recording to file: ' + filename + ' (' + path.normalize(filename) + ')...');
    fs.writeFileSync(filename, resStr);
    var known = {};
    try {
        known = readFileAsJSON(recordingPath + 'queries.json');
    } catch (ex) {

    }
    known[digest] = {
        op: op,
        name: name,
        digest: digest,
        query: query,
        res : len
    };
    fs.writeFileSync(recordingPath + 'queries.json', JSONStringify(known));
}

export function retrieveOp(op: string, name: string, query: any, recordingPath : string) {
    var digest = digestArgs(op,name, query);
    var filename = makeFileName(digest, recordingPath);
    debuglog(' reading from filename ' + filename);
    try {
        var res = readFileAsJSON(filename);
    } catch(e) {
        console.log(e);
        console.log(e.stack);
        console.log(`did not find query result recording (${filename}) \n for collection ${name} operation ${op} \n query arguments: ` + JSONStringify(query));
        throw e;
    }
    if (res === undefined) {
        debuglog('empty result for query ' + op + ' ' + JSON.stringify(query, undefined, 2) + '\n' + filename);
    }
    return res;
}

export function instrumentModelRecord(modelDoc: mongoose.Model<any>, recordingPath: string, theMode: string) {
    console.log('***mongoose_record_replay is instrumenting model ' + modelDoc.modelName + ' for recording to ' + recordingPath );
    var oFind = modelDoc.find;
    modelDoc.find = function (): any {
        debuglog('someone is calling find with ' + modelDoc.modelName + JSON.stringify(arguments, undefined, 2));
        var res = oFind.apply(modelDoc, arguments);
        if (arguments.length !== 1) {
            throw Error('expected one argument in find, was ' + arguments.length);
        }
        var query = arguments[0];
        res.lean().exec().then((a) => {
            //console.log("here result1 + " + JSON.stringify(a, undefined,2) );
            recordOp("find", modelDoc.modelName, query, a, recordingPath);
        }
        );
        return res;
    }
    var oDistinct = modelDoc.distinct;
    modelDoc.distinct = function (): any {
        debuglog('someone is calling distinct with' + JSON.stringify(arguments, undefined, 2));
        var res = oDistinct.apply(modelDoc, arguments);
        if (arguments.length !== 1) {
            throw Error('expected one argument ' + JSON.stringify(arguments));
        }
        var query = arguments[0];
        var res2 = res.then((a) => {
            debuglog( () => "here result1 + " + JSON.stringify(a, undefined,2) );
            try {
                recordOp("distinct", modelDoc.modelName, query, a, recordingPath);
            } catch( ex)
            {
                console.log( ' recording to file failed ' + ex );
                debuglog( () => " recording to file failed " + ex );
                throw ex;
            }
            return a;
        }
        );
        return res; //res2.then((b) => { console.log(' 2nd promise then ' + b && b.length); return b; });
    }
    var oAggregate = modelDoc.aggregate;
    modelDoc.aggregate = function (): any {
        debuglog(() => 'someone is calling aggregate with' + JSON.stringify(arguments, undefined, 2));
        var query = Array.prototype.slice.call(arguments);
        var res = oAggregate.apply(modelDoc, arguments);
        res.then((a) => {
            debuglog(() => "here result1 + " + JSON.stringify(a, undefined, 2));
            recordOp("aggregate", modelDoc.modelName, query, a, recordingPath);
        }
        );
        return res;
    }
}

export function instrumentModelReplay(modelDoc: mongoose.Model<any>, recordingPath: string) {
    console.log('instrumenting model ' + modelDoc.modelName + ' for replay from path ' + recordingPath );
    debuglog('instrumenting model ' + modelDoc.modelName);
    var oFind = modelDoc.find;
    modelDoc.find = function (): any {
        debuglog(() => 'someone is replaying find with' + JSON.stringify(arguments, undefined, 2));
        var query = arguments[0];
        var res = retrieveOp("find", modelDoc.modelName, query, recordingPath);
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
                }
            }
        }
    }
    var oDistinct = modelDoc.distinct;
    modelDoc.distinct = function (): any {
        debuglog('someone is replaying distinct with' + JSON.stringify(arguments, undefined, 2));
        var query = arguments[0];
        var res = retrieveOp("distinct", modelDoc.modelName, query, recordingPath);
        debuglog('returning res ' + JSON.stringify(res) + ' for query find' + query);
        return new Promise(function (resolve, reject) {
            setTimeout(function () { resolve(res); }, 0);
        });
    }
    var oAggregate = modelDoc.aggregate;
    modelDoc.aggregate = function (): any {
        debuglog('someone is replaying aggregate with' + JSON.stringify(arguments, undefined, 2));
        var query = Array.prototype.slice.call(arguments);
        var res = retrieveOp("aggregate", modelDoc.modelName, query, recordingPath);
        var p = new Promise(function (resolve, reject) {
            setTimeout(function () { resolve(res); }, 0);
        });
        (p as any).exec = function () {
            return p;
        }
        return p;
    }
}

/**
 * funtion to instrument mongoose
 *
 *
 *
 * @param mongoose a real mongoose instance
 * @param [path] {string} optional, a path to write/read files from, defaults to "mgrecrep/"
 * @param mode {string}  undefined (environment value) or "REPLAY" or "RECORD"
 */
export function instrumentMongoose(mongoose: mongoose.Mongoose, path: string, mode?: string): mongoose.Mongoose {
    console.log(' ********* instrument mongoose with  ' + path + "  " + mode);
    var theMode = mode || process.env.MONGO_RECORD_REPLAY;
    if (theMode && ["REPLAY", "RECORD"].indexOf(mode) < 0) {
        console.log('passed mode value or env MONGO_RECORD_REPLAY may only be "RECORD" or "REPLAY" , MONGO_RECORD MONGO_REPLAY');
        throw new Error('mongoose_record_replay mode should be one of "REPLAY", "RECORD"  was ' + theMode);
    }
    if (theMode === "RECORD") {
        var recordingPath = path || process.env.MONGO_RECORD_REPLAY_PATH || "mongoose_record_replay";
        console.log( '!* mode RECORD to path ' + recordingPath  + ' in ' + __dirname + " "  + mode );
        assurePath(recordingPath);
        var omodel = mongoose.model;
        mongoose.model = function () {
            if (arguments.length > 1) {
                return instrumentModel(omodel.apply(mongoose, arguments),recordingPath,theMode);
            }
            return omodel.apply(mongoose, arguments);
        }
        return mongoose;
    } else if (theMode === "REPLAY") {
        recordingPath = path || process.env.MONGO_RECORD_REPLAY_PATH || "mongoose_record_replay";
        console.log( '!* mode REPLAY from path ' + recordingPath  + ' in ' + __dirname + " "  + mode  + " " + path);
    //    var r = mongooseMock;
        var r = makeMongooseMock(recordingPath,theMode);
        return r; 
    }
    return mongoose;
}

var mocksPerPath = {};

function makeMongooseMock(recordingPath: string, theMode: string) {
    if ( mocksPerPath[recordingPath] == undefined) {
        var res = {
            models: {},
            recordingPath : recordingPath,
            theMode : theMode,
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
                } as any, this.recordingPath, this.theMode);
                return this.models[a];
            },
            disconnect: function () {
                debuglog('simulationg disconnect ');
            },
            connect: function (connStr: string) {
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
        mocksPerPath[recordingPath] = res;
    }
    return mocksPerPath[recordingPath];
}

export var mongooseMock = {
    models: {},
    recordingPath : "",
    theMode : "",
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
        } as any, this.recordingPath, this.theMode);
        return this.models[a];
    },
    disconnect: function () {
        debuglog('simulationg disconnect ');
    },
    connect: function (connStr: string) {
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
    // e.g. set('useCreateIndex',true)
    set : function(a,b) {},
    connection: dbEmitter
};
