/**
 * instrument mongoose to record/replay queries (!! only queries so far)
 *
 * allows to run (mongoose read only) unit tests w.o. a mongoose instance
 *
 * @file
 */
import * as mongoose from 'mongoose';
/**
 * The recording path, set via argument
 * or
 */
export declare function JSONParse(text: string): any;
export declare function JSONStringify(obj: any): string;
export declare function instrumentModel(model: mongoose.Model<any>, recordingPath: string, theMode: string): any;
export declare function digestArgs(op: string, name: string, query: any): string;
export declare function recordOp(op: string, name: string, query: any, res: any, recordingPath: string): void;
export declare function retrieveOp(op: string, name: string, query: any, recordingPath: string): any;
export declare function instrumentModelRecord(modelDoc: mongoose.Model<any>, recordingPath: string, theMode: string): void;
export declare function instrumentModelReplay(modelDoc: mongoose.Model<any>, recordingPath: string): void;
/**
 * funtion to instrument mongoose
 *
 *
 *
 * @param mongoose a real mongoose instance
 * @param [path] {string} optional, a path to write/read files from, defaults to "mgrecrep/"
 * @param mode {string}  undefined (environment value) or "REPLAY" or "RECORD"
 */
export declare function instrumentMongoose(mongoose: mongoose.Mongoose, path: string, mode?: string): mongoose.Mongoose;
