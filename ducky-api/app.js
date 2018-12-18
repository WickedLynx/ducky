const express = require('express');
const cors = require('cors');
const config = require('./config');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();

app.use(cors());
app.use(bodyParser.json());

app.post('/translate/text', function(req, res) {
	const apiKey = req.headers['api-key'] || "No key";
	const registeredKeys = config.registeredKeys;
	if (!registeredKeys.find((k) => { return k === apiKey })) {
		postError(res, 404, 'Not found');
		return;
	}

	const watsonKey = config.watsonKey;
	const watsonURL = config.watsonURL;
	if (!watsonKey || !watsonURL) {
		postError(res, 500, 'We cannot proceed at this moment');
		return;
	}

	const text = req.body.text;
	if (!text) {
		postError(res, 402, 'Nothing to translate');
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
		console.log(response.data.translations);
	})
	.catch(error => {
		console.log(error);
	});

});

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

app.get('/', function(req, res) {
	res.status(200).json("Wahoooooo!");
});

app.listen(3160, "127.0.0.1", function() {
	console.log("Ducky api is up and running");
});
