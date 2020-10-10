var util = require('util');

/**
 * A transform for nodeunit.js to  jest transformations. 
 * 
 * npm i -g jscodeshift
 * 
 * (dry)
 * 
 * jscodeshift   test\myfile\my.junit.js  --print -d  
 * 
 * replace in situ w.o. the -d 
 * 
 * https://astexplorer.net/  
 * 
 * https://astexplorer.net/#/gist/8c7d9f81226bbbdee5d9c7a2468ddaa0/c3d93b44e2bf90e0ff2553ec1c8d85dd2daf807e
 */


function transformEqual(src, api) {
  const j = api.jscodeshift;
  return api.jscodeshift(src)
    .find(j.ExpressionStatement, {
      expression: {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: {
            type: 'Identifier',
            name: 'test'
          },
          property: (node) => {
            console.log(' Node is ' + node.name);
            return node.type === 'Identifier' && (node.name == 'deepEqual' || node.name == 'equals' || node.name == 'equal');
          },
        },
      },
    }).replaceWith(
      p => {
        console.log('this is p ' + util.inspect(p));
        var cAllExpression = p.value.expression;
        console.log('this is args ' + util.inspect(cAllExpression));
        var exp = j.callExpression(j.identifier('expect'),
          [cAllExpression.arguments[0]]);

        return j.expressionStatement(j.callExpression(
          j.memberExpression(exp, j.identifier('toEqual')),
          [cAllExpression.arguments[1]])
        );
      }
    ).toSource();
}


function transformTestOk(src, api) {
  const j = api.jscodeshift;
  return api.jscodeshift(src)
    .find(j.ExpressionStatement, {
      expression: {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: {
            type: 'Identifier',
            name: 'test'
          },
          property: (node) => {
            console.log(' Node is ' + node.name);
            return node.type === 'Identifier' && (node.name == 'ok');
          },
        },
      },
    }).replaceWith(
      p => {
        console.log('this is p ' + util.inspect(p));
        var cAllExpression = p.value.expression;
        console.log('this is args ' + util.inspect(cAllExpression));
        var exp = j.callExpression(j.identifier('expect'),
          [cAllExpression.arguments[0]]);

        return j.expressionStatement(j.callExpression(
          j.memberExpression(exp, j.identifier('toBeTruthy')),
          [])
        );
      }
    ).toSource();
}


function transformTestExpect(src, api) {
  const j = api.jscodeshift;
  return api.jscodeshift(src)
    .find(j.ExpressionStatement, {
      expression: {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: {
            type: 'Identifier',
            name: 'test'
          },
          property: (node) => {
            return node.type === 'Identifier' && node.name == 'expect';
          },
        },
      },
    }).replaceWith(
      p => {
        console.log('this is p ' + util.inspect(p));
        var cAllExpression = p.value.expression;
        console.log('this is args ' + util.inspect(cAllExpression));
        // var exp = j.callExpression(j.identifier('expect'),
        //   [cAllExpression.arguments[0]]);

        return j.expressionStatement(j.callExpression(
          j.memberExpression(j.identifier('expect'), j.identifier('assertions')),
          [cAllExpression.arguments[0]])
        );
      }
    ).toSource();
}

function transformDoneToComment(src, api) {
  const j = api.jscodeshift;
  return api.jscodeshift(src)
    .find(j.ExpressionStatement, {
      expression: {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: {
            type: 'Identifier',
            name: 'test'
          },
          property: (node) => {
            console.log(' Node is ' + node.name);
            return node.type === 'Identifier' && (node.name == 'done');
          },
        },
      },
    }).replaceWith(
      p => {
        var es = j.emptyStatement();
        es.comments = [j.commentLine('test.done()')];
        return es;
      }
    ).toSource();
}

function transformDoneToInvoke(src, api) {
  const j = api.jscodeshift;
  return api.jscodeshift(src)
    .find(j.ExpressionStatement, {
      expression: {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: {
            type: 'Identifier',
            name: 'test'
          },
          property: (node) => {
            console.log(' Node is ' + node.name);
            
            console.log('done now');
            return node.type === 'Identifier' && (node.name == 'done');
          },
        },
      },
    }).replaceWith(
      p => {
        console.log('replacing done at  '+ util .inspect(p.value));
        var ce = j.callExpression(j.identifier('done'),[]);
        //ce.arguments = null; //[];
        var es = j.expressionStatement(ce); 
        return es;
      }
    ).toSource();
}

function transfromAsyncIt(s3, api) {
  var j = api.jscodeshift;
  return api.jscodeshift(s3)

    .find(j.AssignmentExpression, {
      operator: '=',
      type: (a) => { console.log(' looking at ' + a); return true; },
      left: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'exports' }
      },
      right: { type: 'FunctionExpression' }
    })
    .replaceWith(p => {
      console.log('found sth ' + util.inspect(p));
      var body = p.value.right.body;
      var epName = p.value.left.property.name;
      var af = j.arrowFunctionExpression([], body); af.async = true;
      return j.callExpression(j.identifier('it'), [j.literal(epName), af]);
    }).
    toSource();
}

function transExportsToItDone(s3, api) {
  var j = api.jscodeshift;
  return api.jscodeshift(s3)

    .find(j.AssignmentExpression, {
      operator: '=',
      type: (a) => { console.log(' looking at ' + a); return true; },
      left: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'exports' }
      },
      right: { type: 'FunctionExpression' }
    })
    .replaceWith(p => {
      console.log('found sth ' + util.inspect(p));
      var body = p.value.right.body;
      var epName = p.value.left.property.name;
      var af = j.arrowFunctionExpression([j.identifier('done')], body);
      af.async = false;
      return j.callExpression(j.identifier('it'), [j.literal(epName), af]);
    }).
    toSource();
}



module.exports = function (fileInfo, api, options) {
  var s1 = transformEqual(fileInfo.source, api);
  var s11 = transformTestOk(s1, api);
  var s2 = transformDoneToInvoke(s11, api);
  var s3 = transformTestExpect(s2, api);
  return transExportsToItDone(s3, api);




  //   .find(j.callExpression)FunctionExpre
  //   .findVariableDeclarators('root')
  //   .renameTo('roOt')
  //   .toSource();
};
