'use strict';

var series = require('run-series');
var fs = require('fs');
var console = require('console');

var parser = require('../../parser.js');
var findJsigUri = require('../../lib/find-jsig-uri.js');
var isModuleExports = require('../../lib/is-module-exports.js');
var getJsigIdentifier =
    require('../../lib/get-jsig-identifier.js');
var findByJsigIdentifier =
    require('../../lib/find-by-jsig-identifier.js');
var verify = require('../verify-esprima-ast.js');

module.exports = program;

function program(node, meta, callback) {
    var body = hoistFunctionDeclaration(node.body);

    var moduleExports = body.filter(isModuleExports)[0];
    if (moduleExports) {
        var right = moduleExports.expression.right;
        meta.moduleExportsNode = right;
    }

    findJsigUri(meta.filename, function onJsig(err, jsigUri) {
        if (err) {
            return callback(err);
        }

        if (jsigUri) {
            meta.jsigUri = jsigUri;
            fs.readFile(jsigUri, 'utf8', onfile);
        } else {
            handleBody();
        }

        function onfile(err2, content) {
            if (err2) {
                return callback(err2);
            }

            parser(content, handleBody);
        }
    });

    function handleBody(err, jsigAst) {
        if (err) {
            return callback(err);
        }

        if (jsigAst) {
            storeAndExpand(meta, jsigAst);
        }

        var tasks = body.map(function verifyNode(bodyNode) {
            return verify.bind(null, bodyNode, meta);
        });

        series(tasks, callback);
    }
}

function storeAndExpand(meta, jsigAst) {
    meta.jsigAst = jsigAst;
    var identifier = getJsigIdentifier(meta.jsigUri, meta.filename);

    if (!identifier) {
        return;
    }

    var type = findByJsigIdentifier(jsigAst, identifier);
    if (!type) {
        return;
    }

    if (!meta.moduleExportsNode) {
        console.warn('got a type for file', meta.filename,
            'but got no module.exports');
        return;
    }

    meta.moduleExportsType = type.typeExpression;

    var node = meta.moduleExportsNode;

    if (node.type === 'Identifier') {
        meta.identifiers[node.name] = {
            type: 'variable',
            jsig: type.typeExpression
        };
    } else {
        console.warn('got unknown module.exports node',
            node.type);
    }
}

// hoisting function declarations to the top makes the tree
// order algorithm simpler
function hoistFunctionDeclaration(nodes) {
    var declarations = nodes.filter(function isFunc(node) {
        return node.type === 'FunctionDeclaration';
    });
    var other = nodes.filter(function isNotFunc(node) {
        return node.type !== 'FunctionDeclaration';
    });

    return [].concat(declarations, other);
}
