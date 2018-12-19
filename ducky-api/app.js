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
	translateText(text)
	.then( result => {
		postSuccess(res, result);
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
			translateText(text)
			.then( result => {
				postSuccess(res, result);
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

/**
 * Helpers
 */

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

function translateText(text) {
	return new Promise(function(resolve, reject) {
		const watsonKey = config.watsonKey;
		const watsonURL = config.watsonURL;
		if (!watsonKey || !watsonURL) {
			reject('We cannot proceed at this moment');
			return;
		}
		if (!text) {
			reject('Nothing to translate');
			return;
		}

		var reqConfig = { auth: { username: 'apiKey', password:  watsonKey }};

		axios.post(watsonURL, {
			text: [text],
			'model-id': 'nl-en',
			'source': 'nl',
			'target': 'en'
		}, reqConfig)
		.then((response) => {
			if (!response.data.translations || response.data.translations.length == 0) {
				reject("Failed to translate");
				return;
			}
			resolve(response.data.translations[0]);
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
