#!/usr/bin/env node

'use strict';

var Promise = require('bluebird');
var path = require('path');
var util = require('util');
var fs = Promise.promisifyAll(require('fs'));

var embedArr = [ 'textures', 'shaders' ];
var embed = {};

var argv = require('yargs')
	.usage('Usage: $0 <file> [options]')
	.demand(1)
	.array('e')
	.describe('e', 'embeds textures or shaders into binary GLTF file')
	.choices('e', embedArr)
	.alias('e', 'embed')
	.boolean('cesium')
	.describe('cesium', 'sets the old body buffer name for compatibility with Cesium')
	.help('h')
	.alias('h', 'help')
	.argv;

if (argv.embed) {
	// If just specified as --embed, embed all types into body.
	var arr = argv.embed.length ? argv.embed : embedArr;

	// Enable the specific type of resource to be embedded.
	arr.forEach(function (type) {
		embed[type] = true;
	});
}

var filename = argv._[0];
var BUFFER_NAME = argv.cesium ? 'KHR_binary_glTF' : 'binary_glTF';

if (filename.indexOf('.gltf') != 4) {
	console.error('Failed to create binary GLTF file:');
	console.error('----------------------------------');
	console.error('File specified does not have the .gltf extension.');
	return;
}

// vars us keep track of how large the body will be, as well as the offset for each of the
// original buffers.
var bodyLength = 0;
var bodyParts = [];

var base64Regexp = /^data:.*?;base64,/;
var containingFolder = path.dirname(filename);

function addToBody(uri) {
	var promise;
	if (uri.indexOf('data:') == 0) {
		if (!base64Regexp.test(uri)) throw new Error('unsupported data URI');
		promise = Promise.resolve(new Buffer(uri.replace(base64Regexp, ''), 'base64'));
	}
	else promise = fs.readFileAsync(path.join(containingFolder, uri));

	return promise.then(function (contents) {
		var offset = bodyLength;
		bodyParts.push(offset, contents);
		var length = contents.length;
		bodyLength += length;
		return { offset: offset, length: length };
	});
}

fs.readFileAsync(filename, 'utf-8').then(function (gltf) {
	// Modify the GLTF data to reference the buffer in the body instead of external references.
	var scene = JSON.parse(gltf);

	// var a GLTF parser know that it is using the Binary GLTF extension.
	if (Array.isArray(scene.extensionsUsed)) scene.extensionsUsed.push('KHR_binary_glTF');
	else scene.extensionsUsed = [ 'KHR_binary_glTF' ];

	var bufferPromises = [];
	Object.keys(scene.buffers).forEach(function (bufferId) {
		var buffer = scene.buffers[bufferId];

		// We don't know how to deal with other types of buffers yet.
		var type = buffer.type;

		if (type && type !== 'arraybuffer') {
			throw new Error(util.format('buffer type "%s" not supported: %s', type, bufferId));
		}

		var promise = addToBody(buffer.uri).then(function (obj) {
			// Set the buffer value to the offset temporarily for easier manipulation of bufferViews.
			buffer.byteOffset = obj.offset;
		});

		bufferPromises.push(promise);
	});

	// Run this on the existing buffers first so that the buffer view code can read from it.
	return Promise.all(bufferPromises).return(scene);
}).then(function (scene) {
	Object.keys(scene.bufferViews).forEach(function (bufferViewId) {
		var bufferView = scene.bufferViews[bufferViewId];
		var bufferId = bufferView.buffer;
		var referencedBuffer = scene.buffers[bufferId];

		if (!referencedBuffer) {
			throw new Error(util.format('buffer ID reference not found: %s', bufferId));
		}

		bufferView.buffer = BUFFER_NAME;
		bufferView.byteOffset += referencedBuffer.byteOffset;
	});

	var promises = [];
	if (embed.shaders) Object.keys(scene.shaders).forEach(function (shaderId) {
		var shader = scene.shaders[shaderId];
		var uri = shader.uri;
		shader.uri = '';

		var promise = addToBody(uri).then(function (obj) {
			var bufferViewId = 'binary_shader_' + shaderId;
			shader.extensions = { KHR_binary_glTF: { bufferView: bufferViewId } };

			scene.bufferViews[bufferViewId] =
			{ buffer: BUFFER_NAME
				, byteLength: obj.length
				, byteOffset: obj.offset
			};
		});

		promises.push(promise);
	});

	// TODO: embed images into body (especially if already embedded as base64)
	Object.keys(scene.images).forEach(function (imageId) {
		var image = scene.images[imageId];
		var uri = image.uri;

		var promise = addToBody(uri).then(function (obj) {
			var bufferViewId = 'binary_images_' + imageId;
			// TODO: add extension properties
			image.extensions =
			{ KHR_binary_glTF:
			{ bufferView: bufferViewId
				, mimeType: 'image/i-dont-know'
				, height: 9999
				, width: 9999
			}
			};

			scene.bufferViews[bufferViewId] =
			{ buffer: BUFFER_NAME
				, byteLength: obj.length
				, byteOffset: obj.offset
			};
		});

		promises.push(promise);
	});

	return Promise.all(promises).return(scene);
}).then(function (scene) {
	// All buffer views now reference the implicit "binary_glTF" buffer, so it is no longer needed.
	if (argv.cesium) {
		// Cesium seems to run into issues if this is not defined, even though it shouldn't be needed.
		scene.buffers =
		{ KHR_binary_glTF:
		{ uri: ''
			, byteLength: bodyLength
		}
		};
	}
	else scene.buffers = undefined;

	var newSceneStr = JSON.stringify(scene);
	var sceneLength = Buffer.byteLength(newSceneStr);
	// As body is 4-byte aligned, the scene length must be padded to have a multiple of 4.
	// jshint bitwise:false
	var paddedSceneLength = (sceneLength + 3) & ~3;
	// jshint bitwise:true

	// Header is 20 bytes long.
	var bodyOffset = paddedSceneLength + 20;
	var fileLength = bodyOffset + bodyLength;

	// var's create our GLB file!
	var glbFile = new Buffer(fileLength);

	// Magic number (the ASCII string 'glTF').
	glbFile.writeUInt32BE(0x676C5446, 0);

	// Binary GLTF is little endian.
	// Version of the Binary glTF container format as a uint32 (vesrion 1).
	glbFile.writeUInt32LE(1, 4);

	// Total length of the generated file in bytes (uint32).
	glbFile.writeUInt32LE(fileLength, 8);

	// Total length of the scene in bytes (uint32).
	glbFile.writeUInt32LE(paddedSceneLength, 12);

	// Scene format as a uint32 (JSON is 0).
	glbFile.writeUInt32LE(0, 16);

	// Write the scene.
	glbFile.write(newSceneStr, 20);

	// Add spaces as padding to ensure scene is a multiple of 4 bytes.
	for (var i = sceneLength + 20; i < bodyOffset; ++i) glbFile[i] = 0x20;

	// Write the body.
	for (var i = 0; i < bodyParts.length; i += 2) {
		var offset = bodyParts[i];
		var contents = bodyParts[i + 1];
		contents.copy(glbFile, bodyOffset + offset);
	}

	return fs.writeFileAsync(filename.replace(/\.gltf$/, '.glb'), glbFile);
}).error(function (error) {
	console.error('Failed to create binary GLTF file:');
	console.error('----------------------------------');
	console.error(error);
});
