/*
var ts = require("gulp-typescript")

// according to https://www.npmjs.com/package/gulp-typescript
// not supported
var tsProject = ts.createProject('tsconfig.json', { inlineSourceMap : false })

*/
// gulp.task('scripts', function() {
//    var tsResult = tsProject.src() // gulp.src("lib/*  * / * .ts") // or tsProject.src()
//        .pipe(tsProject())
//
//    return tsResult.js.pipe(gulp.dest('release'))
// })
// *

var gulp = require('gulp');

var ts = require('gulp-typescript');
var sourcemaps = require('gulp-sourcemaps');

/**
 * Directory containing generated sources which still contain
 * JSDOC etc.
 */
// var genDir = 'gen'
var srcDir = 'src';
var testDir = 'test';

gulp.task('watch', function () {
  gulp.watch([srcDir + '/**/*.js', testDir + '/**/*.js', srcDir + '/**/*.tsx', srcDir + '/**/*.ts', 'gulpfile.js'],
    ['tsc', 'babel', 'standard']);
});

/**
 * compile tsc (including srcmaps)
 * @input srcDir
 * @output genDir
 */
gulp.task('tsc', function () {
  var tsProject = ts.createProject('tsconfig.json', { inlineSourceMap: true
  });
  var tsResult = tsProject.src() // gulp.src('lib/*.ts')
    .pipe(sourcemaps.init()) // This means sourcemaps will be generated
    .pipe(tsProject());

  return tsResult.js
    //    .pipe(babel({
    //      comments: true,
    //      presets: ['es2015']
    //    }))
    // .pipe( ... ) // You can use other plugins that also support gulp-sourcemaps
    .pipe(sourcemaps.write('.', {
      sourceRoot: function (file) {
        file.sourceMap.sources[0] = '/projects/nodejs/botbuilder/fdevstar_monmove/src/' + file.sourceMap.sources[0];
        // console.log('here is************* file' + JSON.stringify(file, undefined, 2))
        return 'ABC';
      },
      mapSources: function (src) {
        console.log('here we remap' + src);
        return '/projects/nodejs/botbuilder/mgnlq_model/' + src;
      }}
    )) // ,  { sourceRoot: './' } ))
    // Now the sourcemaps are added to the .js file
    .pipe(gulp.dest('js'));
});

/*
var webpacks = require('webpack-stream')
gulp.task('webpack_notinuse', function() {
  return gulp.src('./src/web/qbetable.tsx')
    .pipe(webpacks( require('./webpack.config.js') ))
    .pipe(gulp.dest('/app/public/js/'))
})

*/

var del = require('del');

gulp.task('clean:models', function () {
  return del([
    'sensitive/_cachefalse.js.zip',
    'testmodel2/_cachefalse.js.zip',
    'testmodel/_cachefalse.js.zip',
    'sensitive/_cachetrue.js.zip',
    'testmodel2/_cachetrue.js.zip',
    'testmodel/_cachetrue.js.zip',
  // here we use a globbing pattern to match everything inside the `mobile` folder
  //  'dist/mobile/**/*',
  // we don't want to clean this file though so we negate the pattern
  //    '!dist/mobile/deploy.json'
  ]);
});

gulp.task('clean', ['clean:models']);

var jsdoc = require('gulp-jsdoc3');

gulp.task('doc', ['test'], function (cb) {
  gulp.src([srcDir + '/**/*.js', 'README.md', './js/**/*.js'], { read: false })
    .pipe(jsdoc(cb));
});

// gulp.task('copyInputFilterRules', ['tsc', 'babel'], function () {
//  return gulp.src([
//    genDir + '/match/inputFilterRules.js'
//  ], { 'base': genDir })
//    .pipe(gulp.dest('gen_cov'))
// })

/*
var instrument = require('gulp-instrument')

gulp.task('instrumentx', ['tsc', 'babel', 'copyInputFilterRules'], function () {
  return gulp.src([
    genDir + '/match/data.js',
    genDir + '/match/dispatcher.js',
    genDir + '/match/ifmatch.js',
    genDir + '/match/inputFilter.js',
    // genDir + '/match/inputFilterRules.js',
    genDir + '/match/matchData.js',
    //  genDir + '/match/inputFilterRules.js',
    genDir + '/utils/*.js',
    genDir + '/exec/*.js'],
    { 'base': genDir
    })
    .pipe(instrument())
    .pipe(gulp.dest('gen_cov'))
})

gulp.task('instrument', ['tsc', 'babel'], function () {
  return gulp.src([genDir + '/**REMOVEME/*.js'])
    .pipe(instrument())
    .pipe(gulp.dest('gen_cov'))
})
*/

// var newer = require('gulp-newer')

var nodeunit = require('gulp-nodeunit');
var env = require('gulp-env');

/**
 * This does not work, as we are somehow unable to
 * redirect the lvoc reporter output to a file
 */
gulp.task('testcov', function () {
  const envs = env.set({
    FSD_COVERAGE: '1',
    FSDEVSTART_COVERAGE: '1'
  });
  // the file does not matter
  gulp.src(['./**/match/dispatcher.nunit.js'])
    .pipe(envs)
    .pipe(nodeunit({
      reporter: 'lcov',
      reporterOptions: {
        output: 'testcov'
      }
    })).pipe(gulp.dest('./cov/lcov.info'));
});

gulp.task('test', ['tsc'], function () {
  gulp.src(['test/**/*.js'])
    .pipe(nodeunit({
      reporter: 'minimal'
    // reporterOptions: {
    //  output: 'testcov'
    // }
    })).on('error', function (err) { console.log('This is weird: ' + err.message); })
    .pipe(gulp.dest('./out/lcov.info'));
});


gulp.task('testhome', ['test'], function () {
  gulp.src(['testdb/**/*.js'])
    .pipe(nodeunit({
      reporter: 'minimal'
    // reporterOptions: {
    //  output: 'testcov'
    // }
    })).on('error', function (err) { console.log('This is weird: ' + err.message); })
    .pipe(gulp.dest('./out/lcov.info'));
});

const eslint = require('gulp-eslint');

gulp.task('standard', () => {
  // ESLint ignores files with "node_modules" paths.
  // So, it's best to have gulp ignore the directory as well.
  // Also, Be sure to return the stream from the task
  // Otherwise, the task may end before the stream has finished.
  return gulp.src(['src/**/*.js', 'test/**/*.js', 'gulpfile.js'])
    // eslint() attaches the lint output to the "eslint" property
    // of the file object so it can be used by other modules.
    .pipe(eslint())
    // eslint.format() outputs the lint results to the console.
    // Alternatively use eslint.formatEach() (see Docs).
    .pipe(eslint.format())
    // To have the process exit with an error code (1) on
    // lint error, return the stream and pipe to failAfterError last.
    .pipe(eslint.failAfterError());
});

const gulpRun = require('gulp-run');

gulp.task('pack', () => {
  return gulpRun('npm pack').exec().pipe(gulp.dest('outpu'));
});

gulp.task('packhome1', ['pack'] , () => {
  return gulpRun('cd ..\\fdevstart && npm i ..\\mgnlq_model\\mgnlq_model-0.1.13.tgz').exec()
  .pipe(gulp.dest('outpu_packhome1'));
});

gulp.task('packhome2', ['pack'] , () => {
  return gulpRun('cd ..\\erbase_bitmap && npm i ..\\mgnlq_model\\mgnlq_model-0.1.13.tgz').exec()
  .pipe(gulp.dest('outpu_packhome2'));
});
gulp.task('packhome', ['packhome1' , 'packhome2' ]);


gulp.task('default', ['tsc', 'standard', 'test', 'doc' ]);


// Default Task
gulp.task('default', ['tsc', 'standard', 'test', 'doc' ]);
gulp.task('build', ['tsc', 'standard']);
