

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
    ['tsc', 'eslint']);
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
    .pipe(sourcemaps.write('.', {
      sourceRoot: function (file) {
        file.sourceMap.sources[0] = '/projects/nodejs/botbuilder/mongoose_record_replay/src/' + file.sourceMap.sources[0];
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


var jsdoc = require('gulp-jsdoc3');

gulp.task('doc', ['test'], function (cb) {
  gulp.src([srcDir + '/**/*.js', 'README.md', './js/**/*.js'], { read: false })
    .pipe(jsdoc(cb));
});

var nodeunit = require('gulp-nodeunit');

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

gulp.task('eslint', () => {
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


// Default Task
gulp.task('default', ['tsc', 'eslint', 'test', 'doc' ]);
gulp.task('build', ['tsc', 'eslint']);
