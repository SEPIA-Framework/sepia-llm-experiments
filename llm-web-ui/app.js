console.log("Welcome to the SEPIA LLM Web UI :-)");

//DOM elements
const inputFormEles = document.querySelectorAll(".chat-input-form");
inputFormEles.forEach((ele) => {
	ele.addEventListener("submit", onInputFormSubmit);
});
const textInputEle = document.getElementById("chat-input-text");
const textInputEleSizeDummy = document.getElementById("chat-input-text-size");
const textInputEleBaseHeight = +window.getComputedStyle(textInputEle).height.replace("px", "");
const textInputEleBaseLineHeight = +window.getComputedStyle(textInputEle).lineHeight.replace("px", "");
textInputEle.value = "";
textInputEle.style.height = textInputEleBaseHeight + "px";		//set start value as inline style
const abortProcButton = document.getElementById("chat-input-abort-button");

const mainChatView = document.getElementById("main-chat-view");
const chatMessageBaseLineHeight = 17;

var chatSlotIdEle = optionsMenu.querySelector("[name=option-chat-slot-id]");
var chatHistoryMaxEle = optionsMenu.querySelector("[name=option-chat-history-max]");
var chatTemplateEle = optionsMenu.querySelector("[name=option-chat-template]");
var systemPromptEle = optionsMenu.querySelector("[name=option-system-prompt]");
var streamResultEle = optionsMenu.querySelector("[name=option-stream-result]");
var cachePromptsOnServerEle = optionsMenu.querySelector("[name=option-cache-prompts]");
var expectSepiaJsonEle = optionsMenu.querySelector("[name=option-expect-sepia-json]");

//Server static stuff - NOTE: the page can be hosted directly from the llama.cpp server if needed
var API_URL = getUrlParameter("llmServer") || getUrlParameter("llm_server") || (window.location.origin + window.location.pathname);
if (!API_URL.endsWith("/")) API_URL += "/";
console.log("LLM server URL:", API_URL);

var isInitialized = false;
var initBuffer = [];

//initialize UI
function onPageReady(){
	getServerProps().then((serverInfo) => {
		console.log("Server info:", serverInfo);
		//make use of server info
		if (serverInfo?.default_generation_settings?.model){
			var model = serverInfo.default_generation_settings.model;
			var baseModel = model.match(/(tiny)/i) || model.match(/(gemma|mistral|phi|llama)/i);	//TODO: add more/fix when templates grow
			if (baseModel){
				console.log("Server model family: " + baseModel[0]);
				var possibleTemplateMatch = chatTemplates.find(t => t.name.toLowerCase().indexOf(baseModel[0].toLowerCase()) >= 0);
				if (possibleTemplateMatch){
					chatTemplateEle.value = possibleTemplateMatch.name;
				}
			}
		}
		/* deprecated:
		if (serverInfo?.system_prompt){
			if (serverInfo.system_prompt.indexOf("your name is SEPIA") >= 0){
				expectSepiaJsonEle.checked = true;
			}else{
				expectSepiaJsonEle.checked = false;
			}
		}
		console.log("Expect SEPIA JSON:", expectSepiaJsonEle.checked);
		*/
		if (!serverInfo?.total_slots || serverInfo.total_slots === 1){
			//disable slot ID if none or only 1 is available
			chatSlotIdEle.value = 0;
			chatSlotIdEle.max = 0;
			chatSlotIdEle.disabled = true;
		}else{
			chatSlotIdEle.max = (serverInfo.total_slots - 1);
		}
		console.log("LLM server slots:", +chatSlotIdEle.max + 1);
		//select system prompt
		var sysPromptName = systemPromptEle.value;		//TODO: keep selected or choose new?
		return loadSystemPrompt(sysPromptName);
	})
	.then((sysPrompt) => {
		//continue
		isInitialized = true;
		while (initBuffer.length){
			var next = initBuffer.shift();
			if (typeof next == "function") next();
		}
	})
	.catch((err) => {
		if (err.name == "FailedToLoadPromptFile"){
			console.error("Failed to load system prompt file.", err);
			showPopUp("ERROR: Failed to load system prompt file.");
		}else if (err.name == "FailedToLoadLlmServerInfo"){
			console.error("Unable to contact the LLM server.", err);
			showPopUp("ERROR: Unable to contact the LLM server. Please double-check if your server is running and reachable, then reload this page.");
		}else{
			console.error("Error in 'onPageReady' function:", err);
		}
		isInitialized = true;
	});
}

//create/close chat
function startChat(){
	contentPage.classList.remove("empty");
	contentPage.classList.add("single-instance");
	
	if (!isInitialized){
		var plzWaitMsg = showPopUp("Please wait a second while the UI is trying to contact the (local, private) LLM server.");
		initBuffer.push(function(){ plzWaitMsg.popUpClose(); });
		if (!initBuffer.length){
			initBuffer.push(function(){ startChat(); });
		}
		return;
	}
	
	activeModel = chatTemplateEle.value || chatTemplates[0].name;
	activeTemplate = chatTemplates.find(t => t.name == activeModel);
	activeSlotId = +chatSlotIdEle.value;
	maxHistory = +chatHistoryMaxEle.value;
	cachePromptsOnServer = cachePromptsOnServerEle.checked;
	expectSepiaJson = expectSepiaJsonEle.checked;
	console.log("Starting chat - Slot ID: " + activeSlotId + ", Max. history: " + maxHistory);
	console.log("Template:", activeTemplate.name, activeTemplate);
	
	var welcomeMessage = activeSystemPromptInfo.welcomeMessage || "Hello world :-)";
	createNewChatAnswer(welcomeMessage).attach();
}
function closeChat(){
	contentPage.classList.add("empty");
	contentPage.classList.remove("single-instance");
	chatHistory = {};
	mainChatView.innerHTML = "";
}
function createNewChat(){
	closeChat();
	startChat();
}

//send/process input
function sendInput(){
	const message = textInputEle.value;
	console.log("sendInput - prompt:", message);	//DEBUG
	textInputEle.value = '';
	//textInputEle.style.height = textInputEleBaseHeight + "px";
	formatTextArea(textInputEle, textInputEleBaseHeight, textInputEleBaseLineHeight);
	var newChatMsg = createNewChatPrompt(message);
	newChatMsg.attach();
	addToHistory(activeSlotId, "user", message);
	chatCompletion(activeSlotId, message, activeTemplate).then(answer => {
		console.log("sendInput - answer:", answer);	//DEBUG
	}).catch(err => {
		console.error("sendInput - ERROR:", err);	//DEBUG
	});
}
function onInputFormSubmit(event){
	//console.log("Submit:", event);		//DEBUG
	event.preventDefault();
	sendInput();
}
function insertTextAtCursor(ele, insertChars){
	//get selection, split and insert
	const start = ele.selectionStart;
	const end = ele.selectionEnd;
	ele.value = ele.value.substring(0, start) + insertChars + ele.value.substring(end);
	//move cursor to correct position
	ele.selectionStart = ele.selectionEnd = start + 1;
}
function formatTextArea(textAreaEle, baseEleHeight, baseLineHeight){
	if (textInputEleSizeDummy){
		if (textAreaEle.value.endsWith("\n")){
			textInputEleSizeDummy.textContent = textAreaEle.value + " ";	//NOTE: hack to force new line
		}else{
			textInputEleSizeDummy.textContent = textAreaEle.value;
		}
		var currentHeight = textInputEleSizeDummy.getBoundingClientRect().height;
		textAreaEle.style.height = currentHeight + "px";
	}else{
		var lines = textAreaEle.value.match(/\n/gm)?.length || 0;
		textAreaEle.style.height = (baseEleHeight + lines * baseLineHeight) + "px";
	}
}
textInputEle.addEventListener('keydown', function(event){
	if (event.key === 'Enter'){
		event.preventDefault();
		if (event.shiftKey){
			//SHIFT + ENTER: add a new line
			insertTextAtCursor(this, "\n");
			formatTextArea(this, textInputEleBaseHeight, textInputEleBaseLineHeight);
		}else{
			//ENTER: trigger send function
			sendInput();
		}
	}else if (event.key === 'Tab'){
        event.preventDefault();
		insertTextAtCursor(this, "\t");
		formatTextArea(this, textInputEleBaseHeight, textInputEleBaseLineHeight);
    }
});
textInputEle.addEventListener('input', function(event){
	//recalculate number of lines
	formatTextArea(this, textInputEleBaseHeight, textInputEleBaseLineHeight);
});

function showAbortButton(){
	abortProcButton.style.removeProperty("display");
}
function hideAbortButton(){
	abortProcButton.style.display = "none";
}
abortProcButton.addEventListener("click", function(){
	hideAbortButton();
	abortCompletion();
});
hideAbortButton();	//hide by default

function createNewChatAnswer(message){
	var cb = createGeneralChatBubble();
	cb.c.classList.add("assistant-reply");
	cb.senderName.textContent = "SEPIA";
	cb.senderIcon.innerHTML = '<svg fill="none" viewBox="0 0 600 600"><use xlink:href="#svg-sepia"></use></svg>';
	if (message){
		cb.setText(message);
	}
	return cb;
}
function createNewChatPrompt(message){
	var cb = createGeneralChatBubble();
	cb.c.classList.add("user-prompt");
	cb.senderName.textContent = "User";
	cb.senderIcon.innerHTML = '<svg viewBox="0 0 45.532 45.532"><use xlink:href="#svg-profile"></use></svg>';
	if (message){
		cb.setText(message);
	}
	return cb;
}
function createGeneralChatBubble(){
	var c = document.createElement("div");
	c.className = "chat-msg-container";
	var cm = document.createElement("div");
	cm.className = "chat-msg";
	var h = document.createElement("div");
	h.className = "chat-msg-header";
	var senderEle = document.createElement("div");
	senderEle.className = "chat-msg-header-sender-box";
	var senderIcon = document.createElement("div");
	senderIcon.className = "chat-msg-header-sender-icon";
	var senderName = document.createElement("div");
	senderName.className = "chat-msg-header-sender-name";
	senderEle.appendChild(senderIcon);
	senderEle.appendChild(senderName);
	var timeEle = document.createElement("div");
	timeEle.textContent = new Date().toLocaleTimeString();
	h.appendChild(senderEle);
	h.appendChild(timeEle);
	var tb = document.createElement("div");
	tb.className = "chat-msg-txt-container";
	//var textEle = document.createElement("textarea");
	var textEle = document.createElement("div");
	textEle.className = "chat-msg-txt";
	var loaderC = document.createElement("div");
	loaderC.className = "chat-msg-loader";
	loaderC.innerHTML = '<svg class="loading-icon" viewBox="0 0 55.37 55.37"><title>Click me to abort generation.</title><use xlink:href="#svg-loading-icon"></use></svg>';
	loaderC.firstChild.addEventListener("click", function(){
		console.log("Triggered completion stop signal");
		abortCompletion();
	});
	var footer = document.createElement("div");
	footer.className = "chat-msg-footer";
	var activeTextParagraph = undefined;
	c.appendChild(cm);
	cm.appendChild(h);
	cm.appendChild(loaderC);
	cm.appendChild(tb);
	cm.appendChild(footer);
	tb.appendChild(textEle);
	return {
		c, senderIcon, senderName, timeEle,
		showLoader: function(skipGlobalAbort){
			loaderC.classList.add("active");
			if (!skipGlobalAbort){
				showAbortButton();
			}
			scrollToNewText(true);
		},
		hideLoader: function(keepGlobalAbort){
			loaderC.classList.remove("active");
			if (!keepGlobalAbort){
				hideAbortButton();
			}
			scrollToNewText(true);
		},
		setText: function(t){
			if (activeTextParagraph){
				activeTextParagraph.textContent = t;
			}else{
				textEle.textContent = t;
			}
			//textEle.value = t;
			//formatTextArea(textEle, chatMessageBaseLineHeight, chatMessageBaseLineHeight);
			scrollToNewText(true);
		},
		addText: function(t){
			var textBox = document.createElement("div");
			textBox.className = "chat-msg-txt-p";
			textBox.textContent = t;
			textEle.appendChild(textBox);
			activeTextParagraph = textBox;
			scrollToNewText(true);
		},
		clearText: function(){
			textEle.innerHTML = "";
		},
		setFooterText: function(t){
			footer.classList.add("active");
			footer.textContent = t;
		},
		hideFooter: function(){
			footer.classList.remove("active");
		},
		addCommand: function(cmdJson){
			var cmdBox = document.createElement("div");
			cmdBox.className = "chat-cmd-code";
			cmdBox.textContent = JSON.stringify(cmdJson, null, 2);
			textEle.appendChild(cmdBox);
			scrollToNewText(true);
		},
		attach: function(){
			mainChatView.appendChild(c);
			scrollToNewText(false);
		}
	};
}

function scrollToNewText(checkPos){
	setTimeout(function(){
		/*
		if (checkPos){
			if (mainChatView.scrollTop == lastAutoScrollPosEnd){
				mainChatView.scrollTop = mainChatView.scrollHeight;
				lastAutoScrollPosEnd = mainChatView.scrollHeight;
			}
		}else{
			mainChatView.scrollTop = mainChatView.scrollHeight;
			lastAutoScrollPosEnd = mainChatView.scrollHeight;
		}
		*/
		mainChatView.scrollTop = mainChatView.scrollHeight;
	}, 0);
}
var lastAutoScrollPosEnd = undefined;


//------- API interface ---------

var activeModel = "";
var activeTemplate = undefined;
var activeSystemPrompt = "";
var activeSystemPromptInfo = {};
var activeSlotId = -1;

var chatHistory = {};	//NOTE: separate histories for each slotId
var maxHistory = -1;	//-1 = whatever the model/server can handle
var cachePromptsOnServer = true;
var expectSepiaJson = true;

//add to history
function addToHistory(slotId, role, content){
	//roles: user, assistant
	if (!chatHistory[slotId]) chatHistory[slotId] = [];
	if (maxHistory === 0) return;
	chatHistory[slotId].push({
		role: role,
		content: content
	});
	//remove first element?
	if (maxHistory > -1 && chatHistory.length > maxHistory){
		chatHistory.shift();
	}
}
function getHistory(slotId){
	return chatHistory[slotId] || [];
}

//format prompt before sending
function formatPrompt(slotId, textIn, template, sysPrompt){
	var formText = buildSystemPrompt(template, sysPrompt);
	formText += buildPromptHistory(slotId, template);
	formText += template.user.replace("{{CONTENT}}", textIn);
	if (template.endOfPromptToken){
		formText += template.endOfPromptToken;
	}
	return formText;
}
function buildSystemPrompt(template, sysPrompt){
	return (template.system?.replace("{{INSTRUCTION}}", sysPrompt) || "");
}
function buildPromptHistory(slotId, template){
	var hist = getHistory(slotId);
	var histStr = "";
	hist.forEach(entry => {
		var tempRole = template[entry.role];
		if (tempRole && entry.content){
			histStr += tempRole.replace("{{CONTENT}}", entry.content);
		}
	});
	return histStr;
}
//send to '/completion' endpoint
async function chatCompletion(slotId, textIn, template){
	if (!textIn || !textIn.trim()){
		return "";
	}
	var endpointUrl = API_URL + "completion";
	var doStream = streamResultEle.checked;
	var chatEle = createNewChatAnswer();
	chatEle.attach();
	chatEle.showLoader();
	const completionAbortCtrl = new AbortController();
	abortCompletion = function(){
		//NOTE: function is assigned to button above
		completionAbortCtrl.abort("canceled");
		chatEle.setFooterText("Please wait ...");
	};
	try {
		var response = await fetch(endpointUrl, {
			method: 'POST',
			body: JSON.stringify({
				id_slot: slotId,
				stream: doStream,
				prompt: formatPrompt(slotId, textIn, template, activeSystemPrompt),
				cache_prompt: cachePromptsOnServer,
				stop: template.stopSignals,
				t_max_predict_ms: 30000			//TODO: we stop predicting after 30s. Track this timer!
				/*
				n_predict: 64,
				temperature: 0.2,
				top_k: 40,
				top_p: 0.9,
				n_keep: n_keep,
				grammar
				*/
			})
			//signal: completionAbortCtrl.signal	
			//NOTE: we ignore the signal here for now and apply it to the streaming only, since we cannot trigger the abort on the server itself in non-streaming mode
		});
	}catch(err){
		console.error("Failed to complete fetch request:", err);		//DEBUG
		chatEle.hideLoader();
		if (err == "canceled"){
			chatEle.setText("- CANCELED (NOTE: Server might still process the request!) -");
			chatEle.setFooterText("CANCELED");
			return;
		}else{
			chatEle.setFooterText("ERROR");
			throw err;
		}
	}
    if (!response.ok){
		console.error("Failed to get result from server:", response);		//DEBUG
		chatEle.setText("-- ERROR --");
		chatEle.hideLoader();
		chatEle.setFooterText("ERROR");
        throw new Error("Failed to get result from server!", {cause: response.statusText});
    }
	//console.log("response", response);		//DEBUG
	try {
		var answer = await processStreamData(response, doStream, slotId, chatEle, completionAbortCtrl);
		answer = postProcessAnswerAndShow(answer, slotId, chatEle);
		chatEle.hideLoader();
	}catch(err){
		chatEle.hideLoader();
		if (err?.name == "AbortError"){
			console.error("Processing 'completion' endpoint data was aborted:", err);	//DEBUG
			chatEle.setFooterText("CANCELED");
			//TODO: clean up
		}else{
			console.error("Failed to process 'completion' endpoint data:", err);	//DEBUG
			chatEle.setFooterText("ERROR");
		}
	}
	return answer;
}
//trigger abort controller
var abortCompletion = function(){};		//NOTE: dynamically assigned

//get data from '/props' endpoint
function getServerProps(){
	return new Promise((resolve, reject) => {
		var endpointUrl = API_URL + "props";
		fetch(endpointUrl, {
			method: 'GET'
		}).then((response) => {
			if (!response.ok){
				console.error("Failed to get server info:", response);		//DEBUG
				throw {
					name: "FailedToLoadLlmServerInfo", 
					message: ("Failed to get server info. Status: " + response.status + " - " + response.statusText),
					cause: response
				};
			}
			return response.json();
		})
		.then((props) => {
			resolve(props);
		})
		.catch((err) => {
			if (err?.name == "FailedToLoadLlmServerInfo"){
				reject(err);
			}else{
				reject({
					name: "FailedToLoadLlmServerInfo", 
					message: ("Failed to get server info."),
					cause: err
				});
			}
		});
	});
}

async function processStreamData(response, isStream, expectedSlotId, chatEle, completionAbortCtrl){
    let answer = "";
	if (isStream){
		//read stream chunk by chunk
		var bytesTotal = 0;
		var decoder = new TextDecoder('utf-8');
		var textBuffer = "";
		var parseDataString = function(l){
			var d = l && l.trim();
			if (d.startsWith("data: ")){
				var data = d.substring(6).trim();
				if (data){
					try {
						var message = JSON.parse(data);
						return message;
					}catch (err){
						console.error("Failed to parse server JSON response:", d);	//DEBUG
					}
				}
			}else{
				console.error("Unexpected stream data:", d);	//DEBUG
			}
		}
		var scanDecodedText = function(isLast){
			//look for line break or end
			if (textBuffer){
				var lines = textBuffer.split(/\n\s*\n/);
				//console.log("lines:", lines);			//DEBUG
				console.log("processing lines:", lines.length);			//DEBUG
				if (lines.length > 1){
					//take last row as rest buffer
					textBuffer = lines.pop();
					//parse everything up till rest
					for (const l of lines){
						var message = parseDataString(l);
						let res = handleParsedMessage(message, expectedSlotId, answer, chatEle);
						if (res.answer){
							answer = res.answer;
						}
						if (res.break){
							textBuffer = "";	//ignore rest
							break;
						}
					}
				}
				if (isLast && textBuffer){
					var message = parseDataString(textBuffer);
					console.log("message JSON:", message);		//DEBUG
					let res = handleParsedMessage(message, expectedSlotId, answer, chatEle);
					if (res.answer){
						answer = res.answer;
					}
				}
			}
		};
		for await (const chunk of response.body){
			if (completionAbortCtrl?.signal?.aborted){
				//TODO: this will (probably) only be triggered when the signal is removed from the fetch function itself for streams.
				//		Both methods have its advantages. Which one is better?
				console.error("processStreamData: aborted");		//DEBUG
				chatEle.setFooterText("CANCELED");
				scanDecodedText(true);
				break;
			}else if (chunk?.length){
				bytesTotal += chunk.length;
				//decode bytes and add to buffer
				textBuffer += decoder.decode(chunk, {stream: false});
				scanDecodedText();
			}
		}
		scanDecodedText(true);
		console.log("processStreamData: done - total bytes:", bytesTotal); //DEBUG
	}else{
		const message = await response.json();
		if (completionAbortCtrl?.signal?.aborted){
			//ignore
			console.log("message JSON (aborted):", message);		//DEBUG
			answer = ignoreFinalMessage(message);
			chatEle.setFooterText("CANCELED");
		}else{
			console.log("message JSON:", message);		//DEBUG
			let res = handleParsedMessage(message, expectedSlotId, answer, chatEle);
			if (res.reachedLimit){
				//TODO: handle
			}
			answer = res.answer;
		}
	}
	return answer;
}
function ignoreFinalMessage(message){
	if (message.timings){
		console.log("time to process prompt (ms):", message.timings?.prompt_ms);		//DEBUG
		console.log("time to generate answer (ms):", message.timings?.predicted_ms);	//DEBUG
	}
	return "";
}
function handleParsedMessage(message, expectedSlotId, answer, chatEle){
	if (message.timings){
		console.log("time to process prompt (ms):", message.timings?.prompt_ms);		//DEBUG
		console.log("time to generate answer (ms):", message.timings?.predicted_ms);	//DEBUG
	}
	let slotId = message.id_slot;
	if (slotId != expectedSlotId){
		if (expectedSlotId == -1){
			activeSlotId = expectedSlotId;
		}else{
			console.error("Wrong slot ID - Expected: " + expectedSlotId, "saw:", slotId);	//DEBUG
			return {break: true};
		}
	}
	answer += message.content;
	chatEle.setText(answer);
	chatEle.hideLoader(true);
	//console.log("processStreamData:", message.content); //DEBUG
	if (message.stop){
		if (message.truncated){
			console.error("TODO: Message is truncated");	//DEBUG
			chatEle.setFooterText("TRUNCATED");
		}
		if (message.stopped_limit){
			console.error("TODO: Message stopped due to limit!",
				(message.timings?.predicted_ms || "???") + "ms", (message.timings?.predicted_n || "???") + " tokens");	//DEBUG
			chatEle.setFooterText("LIMIT REACHED");
		}
		return {break: true, answer: answer, reachedLimit: message.stopped_limit};
	}
	return {break: false, answer: answer};
}
function postProcessAnswerAndShow(answer, slotId, chatEle){
	answer = answer.replace(/^[\r\n]+/, "").replace(/[\r\n]+$/, "");	//remove leading and trailing line breaks
	var answers = answer.split(/^[\r\n]+/gm);
	console.log("answers:", answers);		//DEBUG
	chatEle.clearText();
	answers.forEach(ans => {
		//process all answers if there was more than one and the LLM got confused
		ans = ans.trim();
		var ansJson;
		if (expectSepiaJson){
			//try to clean up in advance (Gemma-2 2B has some issues here for example)
			ans = ans.replace(/^(```json)/, "").replace(/^[\n]/, "");
			ans = ans.replace(/(```)$/, "").replace(/[\n]$/, "");
		}
		if (ans.startsWith("{") && ans.endsWith("}")){
			try {
				//TODO: this can fail for example if quotes where used inside the JSON message (not escaped \")
				ansJson = JSON.parse(ans);
				addToHistory(slotId, "assistant", JSON.stringify(ansJson));
			}catch(err){
				console.error("Failed to handle answer while trying to parse:", ans);		//DEBUG
				ansJson = {"error": "Failed to handle answer while trying to parse JSON"};
			}
		}else{
			ansJson = {command: "chat", message: ans};	//NOTE: this will recover text if SEPIA JSON was expected but LLM decided to ignore it
			if (expectSepiaJson){
				addToHistory(slotId, "assistant", JSON.stringify(ansJson));
			}else{
				addToHistory(slotId, "assistant", ans);
			}
		}
		if (ansJson.command == "chat"){
			chatEle.addText(ansJson.message);
		}else{
			chatEle.addCommand(ansJson);
		}
	});
}

//----- chat templates and system prompts ------

const chatTemplates = [{
	name: "LLaMA_3.1_8B_Instruct",
	llmInfo: {
		infoPrompt: "Your LLM is called LLaMA 3.1 with 8B parameters and works offline, on device, is open and may be used commercially under certain conditions. LLaMA has been trained by the company Meta, but your training data is somewhat of a mystery."
	},
	system: "<|start_header_id|>system<|end_header_id|>{{INSTRUCTION}}<|eot_id|>",
	user: "<|start_header_id|>user<|end_header_id|>{{CONTENT}}<|eot_id|>",
	assistant: "<|start_header_id|>assistant<|end_header_id|>{{CONTENT}}<|eot_id|>",
	endOfPromptToken: "assistant",
	stopSignals: ["<|eot_id|>"]
},{
	name: "Mistral-7B-Instruct",
	llmInfo: {
		infoPrompt: "Your LLM is called Mistral-7B and works offline, on device, is open and may be used commercially under certain conditions. Mistral-7B has been trained by the company Mistral AI, but your training data is somewhat of a mystery."
	},
	system: "[INST] {{INSTRUCTION}} [/INST] </s>",		//NOTE: we omit the BOS token <s> here since the LLM server adds it
	user: "<s>[INST] {{CONTENT}} [/INST]",
	assistant: "{{CONTENT}}</s>",
	endOfPromptToken: "",
	stopSignals: ["</s>"]
},{
	name: "Gemma-2-it",
	llmInfo: {
		infoPrompt: "Your LLM is called Gemma 2 and works offline, on device, is open and may be used commercially under certain conditions. Gemma 2 has been trained by Google, but your training data is somewhat of a mystery."
	},
	system: "<start_of_turn>user\n\n{{INSTRUCTION}}\n\n <end_of_turn>",
	user: "<start_of_turn>user\n\n{{CONTENT}}<end_of_turn>",
	assistant: "<start_of_turn>model\n\n{{CONTENT}}<end_of_turn>",
	endOfPromptToken: "<start_of_turn>model",
	stopSignals: ["<end_of_turn>"]
},{
	name: "Phi-3-instruct",
	llmInfo: {
		infoPrompt: "Your LLM is called Phi 3, works offline, on device, is open and may be used commercially under certain conditions. Phi 3 has been trained by Microsoft, but your training data is somewhat of a mystery."
	},
	system: "<|system|>\n{{INSTRUCTION}}<|end|>\n",
	user: "<|user|>\n{{CONTENT}}<|end|>\n",
	assistant: "<|assistant|>\n{{CONTENT}}<|end|>\n",
	endOfPromptToken: "<|assistant|>\n",
	stopSignals: ["</s>", "<|end|>"]
},{
	name: "TinyLlama_1.1B_Chat",
	llmInfo: {
		infoPrompt: "Your LLM is called TinyLlama, has 1.1B parameters, works offline, on device, is open and may be used commercially under certain conditions. More information about TinyLlama can be found on its GitHub project page."
	},
	system: "<|system|>\n\n{{INSTRUCTION}}<|endoftext|>",
	user: "<|user|>\n\n{{CONTENT}}<|endoftext|>",
	assistant: "<|assistant|>\n\n{{CONTENT}}<|endoftext|>",
	endOfPromptToken: "<|assistant|>",
	stopSignals: ["</s>", "<|endoftext|>"]
}];
//["</s>", "<|end|>", "<|eot_id|>", "<|end_of_text|>", "<|im_end|>", "<|EOT|>", "<|END_OF_TURN_TOKEN|>", "<|end_of_turn|>", "<|endoftext|>", "assistant", "user"]

//add templates to selector
chatTemplates.forEach((tmpl) => {
	var opt = document.createElement("option");
	opt.textContent = tmpl.name;
	opt.value = tmpl.name;
	chatTemplateEle.appendChild(opt);
});

const systemPrompts = [{
	name: "SEPIA Chat",
	promptText: "You are a voice assistant, your name is SEPIA. You have been created to answer general knowledge questions and have a nice and friendly conversation. Your answers are short and precise, but can be funny sometimes.",
	welcomeMessage: "Hello, my name is SEPIA. I'm here to answer your questions and have a friendly conversation :-)",
	expectSepiaJson: false
},{
	name: "SEPIA Smart Home Control",
	file: "SEPIA_smart_home_control.txt",
	welcomeMessage: "Hello, my name is SEPIA. I'm here to control your smart home, answer your questions and have a friendly conversation :-)\nWhen I recognize a smart home request, I will show the JSON command in the chat for demonstration purposes, instead of a chat message.",
	expectSepiaJson: true,
	promptVariables: [{key: "infoPrompt", name: "{{LLM_INFO_PROMPT}}"}]
}];

//add prompts to selector
systemPrompts.forEach((sp, index) => {
	var opt = document.createElement("option");
	opt.textContent = sp.name;
	opt.value = sp.name;
	if (index == 0) opt.selected = true;
	systemPromptEle.appendChild(opt);
});
//load prompts via selector
systemPromptEle.addEventListener("change", function(){
	loadSystemPrompt(systemPromptEle.value).catch((err) => {
		console.error("Failed to load system prompt file.", err);
		showPopUp("ERROR: Failed to load system prompt file.");
		//TODO: reset field
	});
});
//prompt loader
function loadSystemPrompt(name){
	return new Promise((resolve, reject) => {
		var sysPromptInfo = systemPrompts.find((sp) => sp.name == name);
		activeSystemPromptInfo = sysPromptInfo;
		if (sysPromptInfo.file){
			var loadMsg = showPopUp("Loading system prompt file...");
			loadFile("system-prompts/" + sysPromptInfo.file, "text").then((sp) => {
				//apply text from file
				activeSystemPrompt = applySystemPromptVariables(sp, sysPromptInfo.promptVariables);
				expectSepiaJsonEle.checked = sysPromptInfo.expectSepiaJson;
				loadMsg.popUpClose();
				resolve(activeSystemPrompt);
			}).catch((err) => {
				//failed to load file
				activeSystemPrompt = "";
				expectSepiaJsonEle.checked = false;
				console.error("Failed to load system prompt file:", sysPromptInfo.file, err);
				loadMsg.popUpClose();
				reject({
					name: "FailedToLoadPromptFile",
					message: "Failed to load system prompt file.",
					cause: err
				});
			});
		}else if (sysPromptInfo.promptText){
			//apply text directly
			activeSystemPrompt = applySystemPromptVariables(sysPromptInfo.promptText, sysPromptInfo.promptVariables);
			expectSepiaJsonEle.checked = sysPromptInfo.expectSepiaJson;
			resolve(activeSystemPrompt);
		}else{
			activeSystemPrompt = "";
			expectSepiaJsonEle.checked = false;
			resolve(activeSystemPrompt);
		}
	});
}
function applySystemPromptVariables(sysPrompt, promptVariables){
	//apply system prompt variables
	var selectedTemplate = chatTemplates.find(t => t.name == chatTemplateEle.value);
	if (promptVariables){
		if (!selectedTemplate || !selectedTemplate.llmInfo){
			console.error("Failed to apply system prompt variables due to missing template or template 'llmInfo'.");
			return sysPrompt;
		}
		promptVariables.forEach(function(pv){
			var llmInfoVal = selectedTemplate.llmInfo[pv.key];
			if (llmInfoVal == undefined){
				console.error("Active template is missing LLM info for sys. prompt variable '" + pv.key + "'.");
			}else{
				sysPrompt = sysPrompt.replaceAll(pv.name, llmInfoVal);
			}
		});
	}
	console.log("System prompt:", sysPrompt);		//DEBUG
	return sysPrompt;
}

//initialize
onPageReady();
