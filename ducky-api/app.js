const express = require('express');
const cors = require('cors');
const config = require('./config');
const bodyParser = require('body-parser');
const axios = require('axios');
const shortid = require('shortid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const exec = require('child_process').exec;
const rimraf = require('rimraf');
const htmlParser = require('htmlparser2');

const app = express();
const upload = multer({ dest: 'uploads/' });

/**
 * Auth
 */

const authenticator = function(req, res, next) {
	const apiKey = req.headers['api-key'] || "no key";
	const registeredKeys = config.registeredKeys;
	if(!registeredKeys.find( k => { return k === apiKey })) {
		postError(res, 404, 'Not found');
		return;
	}
	next();
}

/**
 * Register middleware
 */

app.use(cors());
app.use(bodyParser.json({ limit: '10mb'}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(authenticator);

/**
 * Routes
 */

app.post('/translate/text', function(req, res) {
	const text = req.body.text;
	translate([text])
	.then( result => {
		postSuccess(res, { translation: result[0].translation });
	})
	.catch(error => {
		postError(res, 500, error);
	});
});

app.post('/translate/image', upload.single('image'), function(req, res) {
	const tempPath = req.file.path;
	const name = shortid.generate() + '.' + (path.extname(req.file.originalname).extname || 'png');
	const targetPath = path.join(__dirname, `./uploads/${name}`);
	fs.rename(tempPath, targetPath, err => {
		if (err) {
			postError(res, 500, 'There was an error');
			return;
		}
		performOCR(targetPath)
		.then( text => {
			translate([text])
			.then( result => {
				postSuccess(res, { translation: result[0].translation });
			})
			.catch( error => {
				postError(res, 500, error);
			});
		})
		.catch( err => {
			postError(res, 500, err);
		});
	});
});

app.post('/translate/html', upload.single('html'), function(req, res) {
	const tempPath = req.file.path;
	const name = shortid.generate() + '.' + (path.extname(req.file.originalname).extname || 'html');
	const targetPath = path.join(__dirname, `./uploads/${name}`);
	fs.rename(tempPath, targetPath, err => {
		if (err) {
			postError(res, 500, 'There was an error');
			return;
		}
		translateHTMLFile(targetPath)
		.then(result => {
			postSuccess(res, { html: result });
		})
		.catch(err => {
			postError(res, 500, 'Could not translate');
		});
	});
});

/**
 * Helpers
 */

function translateHTMLFile(path) {
	return new Promise((resolve, reject) => {
		fs.readFile(path, { encoding: 'utf8' }, (err, html) => {
			if (err) { reject('Cannot read file'); return; }

			const ignoredTags = ['script', 'head', 'style', 'noscript', 'meta', 'html'];
			let ignoreNext = false;
			let toTranslate = [];

			const parser = new htmlParser.Parser({
				onopentag: (name, attribute) => {
					if (ignoredTags.find( t => { return t === name.trim().toLowerCase() })) {
						ignoreNext = true;
					}
				},
				ontext: (text) => {
					if(!ignoreNext) {
						toTranslate.push(text);
					}
				},
				onclosetag: (name, attribute) => {
					ignoreNext = false;
				}
			});
			parser.write(html);
			parser.end();

			const nonClosingTags = ['meta', 'link', 'input', 'img'];

			translate(toTranslate)
			.then(result => {
				if (result.length !== toTranslate.length) { reject('Translation failed'); return; }
				let translated = '';
				let index = 0;

				const writer = new htmlParser.Parser({
					onopentag: (name, attributes) => {
						translated = translated + `\n<${name} ${stringifyAttributes(attributes)}>`;
						if (ignoredTags.find( t => { return t === name.trim().toLowerCase() })) {
							ignoreNext = true;
						}
					},
					ontext: (text) => {
						if(ignoreNext) {
							translated = translated + text;
						} else {
							translated = translated + result[index].translation;
							index++;
						}
					},
					onclosetag: (name, attribute) => {
						ignoreNext = false;
						if (!nonClosingTags.find( t => { return t === name.trim().toLowerCase() })) {
							translated = translated + `</${name}>`
						}
					}
				});
				writer.write(html);
				writer.end();
				resolve(translated);
			})
			.catch(err => {
				reject(err);
			});
		});
	});
}

function stringifyAttributes(attributes) {
	if (!attributes) { return ' '; }
	let strung = '';
	for (const name in attributes) {
		if (attributes.hasOwnProperty(name)) {
			strung += ` ${name}="${attributes[name]}"`
		}
	}
	return strung;
}

function performOCR(fileName) {
	return new Promise(function(resolve, reject) {
		if (!fileName) {
			reject('File not found');
			return;
		}
		exec("tesseract " + fileName + ' stdout', function(err, stdout, stderr) {
			rimraf(fileName, err => {
				if (err) {
					console.log(err);
				}
			});
			if (err || stderr) {
				reject('Failed to perform OCR');
				return;
			}
			resolve(stdout);
		});
	});
}

function translate(texts) {
	return new Promise(function(resolve, reject) {
		const watsonKey = config.watsonKey;
		const watsonURL = config.watsonURL;
		if (!watsonKey || !watsonURL) {
			reject('We cannot proceed at this moment');
			return;
		}
		if (!texts) {
			reject('Nothing to translate');
			return;
		}

		var reqConfig = { auth: { username: 'apiKey', password:  watsonKey }};

		axios.post(watsonURL, {
			text: texts,
			'model-id': 'nl-en',
			'source': 'nl',
			'target': 'en'
		}, reqConfig)
		.then((response) => {
			if (!response.data.translations || response.data.translations.length == 0) {
				reject("Failed to translate");
				return;
			}
			resolve(response.data.translations);
		})
		.catch(error => {
			reject("Failed to translate");
		});
	});
}

function postError(res, code, message) {
	res.status(code).json({
		code: code,
		message: message
	});
}

function postSuccess(res, object) {
	res.status(200).json({
		data: object,
		error: null
	});
}

app.listen(3160, "127.0.0.1", function() {
	console.log("Ducky api is up and running");
});
