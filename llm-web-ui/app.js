import * as uiComponents from "./ui.components.js"
import * as chatHistory from "./chat.history.js"
import * as llmSettings from "./llm.settings.js"

var ui = {
	components: uiComponents
}
var chat = {
	history: chatHistory
}
var llm = {
	settings: llmSettings
}
//export for testing
window.ui = ui;
window.chat = chat;
window.llm = llm;

//DOM elements
const inputFormEles = document.querySelectorAll(".chat-input-form");
inputFormEles.forEach((ele) => {
	ele.addEventListener("submit", onInputFormSubmit);
});
const textInputEle = document.getElementById("chat-input-text");
const textInputEleSizeDummy = document.getElementById("chat-input-text-size");
textInputEle.value = "";
textInputEle.addEventListener('keyup', (ev) => {
	if (ev.key === 'Escape'){
		console.log('You pressed ESC');
	}
});
const abortProcButton = document.getElementById("chat-input-abort-button");
const mainChatView = document.getElementById("main-chat-view");
//header
var createChatBtn = document.getElementById("create-chat-btn");
var closeChatBtn = document.getElementById("close-chat-btn");
var editHistoryBtn = document.getElementById("edit-history-btn");

//clean up before page close (TODO: mobile might require 'visibilitychange')
window.addEventListener("beforeunload", function(e){
	cleanUpOnPageClose();
});

//Server static stuff - NOTE: the page can be hosted directly from the llama.cpp server if needed
var API_URL = getUrlParameter("llmServer") || getUrlParameter("llm_server") || (window.location.origin + window.location.pathname);
if (!API_URL.endsWith("/")) API_URL += "/";
console.log("LLM server URL:", API_URL);

var isInitialized = false;
var blockChatStart = false;
var chatIsClosed = true;
var initBuffer = [];
var startChatBuffer = [];
var completionFinishedBuffer = [];

var isPromptProcessing = false;

//initialize UI
function onPageReady(){
	console.log("Welcome to the SEPIA LLM Web UI :-)");
	getServerProps().then((serverInfo) => {
		console.log("Server info:", serverInfo);
		//make use of server info
		if (serverInfo?.default_generation_settings?.model){
			var model = serverInfo.default_generation_settings.model;
			var possibleTemplateMatch = llm.settings.findBestModelMatch(model);
			if (possibleTemplateMatch){
				llm.settings.setChatTemplate(possibleTemplateMatch.name);
			}
		}
		llm.settings.setNumberOfServerSlots(serverInfo?.total_slots);
		//load slot info
		return getServerSlots(true);	//NOTE: is soft-fail = will not throw error for catch
	})
	.then((serverSlots) => {
		if (serverSlots?.error){
			if (serverSlots.error?.status == 501){
				console.warn("Unable to load LLM server slot info. Slots are not enabled!");
			}else{
				console.error("Unable to load LLM server slot info.", serverSlots.error);
			}
			llm.settings.disablePromptCachingOnServer();
			console.warn("NOTE: To avoid issues with concurrent users the prompt cache has been disabled!");
			llm.settings.setNumberOfServerSlots(0);		//NOTE: 0 is disabled
		}else{
			//NOTE: we check for free slots later again
		}
		//load system prompt
		return llm.settings.loadSystemPrompt();
	})
	.then((sysPrompt) => {
		//continue
		isInitialized = true;
		let initHadErrors = false;
		while (initBuffer.length){
			var next = initBuffer.shift();
			if (typeof next?.fun == "function") next.fun(initHadErrors);
		}
	})
	.catch((err) => {
		if (err.name == "FailedToLoadPromptFile"){
			console.error("Failed to load system prompt file.", err);
			showPopUp("ERROR: Failed to load system prompt file.");
		}else if (err.name == "FailedToLoadSystemPrompt"){
			console.error("Failed to load custom system prompt.", err);
			showPopUp("ERROR: Failed to load custom system prompt. Please add your prompt via the settings.");
		}else if (err.name == "FailedToLoadLlmServerInfo"){
			console.error("Unable to contact the LLM server.", err);
			showPopUp("ERROR: Unable to contact the LLM server. Please double-check if your server is running and reachable, then reload this page.");
		}else if (err.name == "FailedToLoadLlmServerSlots"){
			//NOTE: this will only trigger when 'getServerSlots' is called with softFail = false
			console.error("Unable to load LLM server slot info.", err);
			llm.settings.setNumberOfServerSlots(0);
		}else{
			console.error("Error in 'onPageReady' function:", err);
		}
		isInitialized = true;
		let initHadErrors = true;
		while (initBuffer.length){
			var next = initBuffer.shift();
			if (typeof next?.fun == "function") next.fun(initHadErrors);
		}
		blockChatStart = true;
	});
}
function toggleButtonVis(enableChat){
	if (enableChat){
		createChatBtn.style.display = "none";
		closeChatBtn.style.removeProperty("display");
		//editHistoryBtn.classList.remove("disabled");
	}else{
		createChatBtn.style.removeProperty("display");
		closeChatBtn.style.display = "none";
		//editHistoryBtn.classList.add("disabled");
	}
}
toggleButtonVis(false);

//create/close chat
function startChat(){
	if (blockChatStart){
		//TODO: for now we just block, but we should try init again instead
		showPopUp("There was an error during the initialization. Please reload the page.", [
			{name: "Reload", fun: function(){ window.location.reload(); }}
		]);
		return;
	}
	chatIsClosed = false;
	contentPage.classList.remove("empty");
	contentPage.classList.add("single-instance");
	
	if (!isInitialized){
		var plzWaitMsg = showPopUp("Please wait a second while the UI is trying to contact the (local, private) LLM server.");
		initBuffer.push({
			id: "close-wait-msg",
			fun: function(failedInit){ plzWaitMsg.popUpClose(); }
		});
		if (!initBuffer.find((e) => e.id == "start-chat")){
			//make sure we add this only once
			initBuffer.push({
				id: "start-chat",
				fun: function(initHadErrors){
					if (!initHadErrors){
						startChat();
					}else{
						if (!chatIsClosed) closeChat();
					}
				}
			});
		}
		return;
	}
		
	//check free slots
	var numOfSlots = llm.settings.getNumberOfServerSlots();
	if (numOfSlots > 0){
		var welcomeMsg = createNewChatAnswer("");
		welcomeMsg.attach();
		welcomeMsg.showLoader(true);
		getFreeServerSlot(numOfSlots).then((slotId) => {
			if (slotId != undefined && slotId > -1){
				//assign free slot
				llm.settings.setActiveServerSlot(slotId);
				initNewChat(welcomeMsg, true);
			}else{
				//no free slots or unable to read slot data
				var msg = showFormPopUp([
					{label: "Sorry, but it seems there are currently no free slots available (LLM server is busy). Please try again later!"},
					{submit: true, name: "Free up slots"}
				], function(){
					closeChat().finally(() => {
						freeAllServerSlotsPopUp();
					});
				});
				welcomeMsg.setText("I'm very busy right now. Please come back later! :-)");
				welcomeMsg.setFooterText("CHAT CLOSED");
				welcomeMsg.hideLoader();
				llm.settings.setActiveServerSlot(-1);
				startChatBuffer = [];	//TODO: remove buffered actions or keep?
				toggleButtonVis(true);
				chatIsClosed = true;
			}
		});
	}else{
		//incompatible server
		showPopUp("Sorry, but it seems that your server is incompatible with this version of the app. Please make sure it supports slot management.");
		var welcomeMsg = createNewChatAnswer("");
		welcomeMsg.attach();
		welcomeMsg.setText("Please check your server settings and make sure to enable slot management.");
		welcomeMsg.setFooterText("CHAT CLOSED");
		llm.settings.setActiveServerSlot(-1);
		startChatBuffer = [];	//TODO: remove buffered actions or keep?
		toggleButtonVis(true);
		chatIsClosed = true;
	}
}
function initNewChat(welcomeMsg, cacheSysPrompt){
	var activeSlotId = llm.settings.getActiveServerSlot();
	console.log("Starting new chat - Slot ID: " + activeSlotId + ", Max. history: " + llm.settings.getMaxChatHistory());
	var activeTemplate = llm.settings.getChatTemplate();
	console.log("Template:", activeTemplate?.name, activeTemplate);
	toggleButtonVis(true);
	
	var welcomeMessageText = llm.settings.getSystemPromptInfo()?.welcomeMessage || "Hello world :-)";
	if (!welcomeMsg){
		welcomeMsg = createNewChatAnswer();
		welcomeMsg.attach();
	}
	if (cacheSysPrompt){
		chatCompletionSystemPromptOnly(activeSlotId, activeTemplate).then((response) => {
			return response.json();
		}).then((resJson) => {
			//TODO: eval
			//console.error("sys prompt response:", resJson);		//DEBUG
			welcomeMsg.hideLoader();
			welcomeMsg.setText(welcomeMessageText);
			onNewChatReady();
		}).catch((err) => {
			//TODO: handle
			console.error("Failed to upload system prompt:", err);		//DEBUG
			welcomeMsg.hideLoader();
			onNewChatReady();
		});
	}else{
		welcomeMsg.hideLoader();
		welcomeMsg.setText(welcomeMessageText);
		onNewChatReady();
	}
}
function onNewChatReady(){
	//restore history
	chat.history.restore();
	//have some actions buffered?
	while (startChatBuffer.length){
		var next = startChatBuffer.shift();
		if (typeof next?.fun == "function") next.fun();
	}
}
function closeChat(){
	contentPage.classList.add("empty");
	contentPage.classList.remove("single-instance");
	chat.history.clearAll();
	mainChatView.innerHTML = "";
	return new Promise((resolve, reject) => {
		if (!chatIsClosed && llm.settings.getNumberOfServerSlots() > 0){
			//try to clean up server history
			chatIsClosed = true;
			var msg = showPopUp("Cleaning up ...");
			freeServerSlot(llm.settings.getActiveServerSlot()).then((res) => {
				msg.popUpClose();
				toggleButtonVis(false);
				resolve({success: true, closedSlot: true});
			}).catch((err) => {
				showPopUp("I'm sorry, but the chat clean-up failed :-(. See log for more info.");
				console.error("Failed to reset slot prompt:", err);		//DEBUG
				msg.popUpClose();
				toggleButtonVis(false);
				reject({
					name: "FailedToCloseSlot", 
					message: ("Failed to close slot."),
					cause: err
				});
			});
		}else{
			chatIsClosed = true;
			toggleButtonVis(false);
			resolve({success: true});
		}
	});
}
function createNewChat(){
	if (isPromptProcessing){
		showPopUp("You input is still being processed. Please wait a few seconds until the chat has finished.");
		//completionFinishedBuffer.push(function(){ createNewChat(); });
		//abortCompletion();
		return;
	}
	closeChat().then((res) => {
		startChat();
	}).catch((err) => {
		if (err?.name == "FailedToCloseSlot"){
			//TODO: ignore for now
		}
	});
}
function cleanUpOnPageClose(){
	abortCompletion();
	closeChat();
}

function editChatHistory(){
	if (editHistoryBtn.classList.contains("disabled")){
		showPopUp("To view/edit your chat history, please start a chat first.");
	}else if (chatIsClosed){
		ui.components.showSystemPromptEditor();
	}else{
		ui.components.showChatHistoryEditor();
	}
}

function freeAllServerSlotsPopUp(){
	var msg = showFormPopUp([
		{label: "Do you really want to free up all slots? This can potentially mess up the chat for other concurrent users!"},
		//{customButton: {name: "Maybe", fun: function(){ console.log("OK"); }}},
		{submit: true, name: "I know what I'm doing. Let's go!"}
	], function(formData){
		var llmServerSlots = llm.settings.getNumberOfServerSlots();
		if (llmServerSlots >= 1){
			var msg = showPopUp("Cleaning up ...");
			var sfpa = [];
			for (let i = 0; i < llmServerSlots; i++){
				sfpa.push(freeServerSlot(i));
			}
			Promise.all(sfpa).then((results) => {
				console.log("Free slot results:", results);
				msg.popUpClose();
			});
		}
	});
}

//send/process input
function sendInput(){
	if (chatIsClosed) return;
	const message = textInputEle.value;
	console.log("sendInput - prompt:", message);	//DEBUG
	textInputEle.value = '';
	formatTextArea(textInputEle);
	var newChatMsg = createNewChatPrompt(message);
	newChatMsg.attach();
	chat.history.add(llm.settings.getActiveServerSlot(), "user", message);
	isPromptProcessing = true;
	chatCompletion(llm.settings.getActiveServerSlot(), message, llm.settings.getChatTemplate()).then(answer => {
		isPromptProcessing = false;
		console.log("sendInput - answer:", answer);	//DEBUG
	}).catch(err => {
		isPromptProcessing = false;
		console.error("sendInput - ERROR:", err);	//DEBUG
		while (completionFinishedBuffer.length){
			var next = completionFinishedBuffer.shift();
			if (typeof next == "function") next();
		}
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
function formatTextArea(textAreaEle){
	if (textAreaEle.value.endsWith("\n")){
		textInputEleSizeDummy.textContent = textAreaEle.value + " ";	//NOTE: hack to force new line
	}else{
		textInputEleSizeDummy.textContent = textAreaEle.value;
	}
	var currentHeight = textInputEleSizeDummy.getBoundingClientRect().height;
	textAreaEle.style.height = currentHeight + "px";
}
textInputEle.addEventListener('keydown', function(event){
	if (event.key === 'Enter'){
		event.preventDefault();
		if (event.shiftKey){
			//SHIFT + ENTER: add a new line
			insertTextAtCursor(this, "\n");
			formatTextArea(this);
		}else{
			//ENTER: trigger send function
			sendInput();
		}
	}else if (event.key === 'Tab'){
        event.preventDefault();
		insertTextAtCursor(this, "\t");
		formatTextArea(this);
    }
});
textInputEle.addEventListener('input', function(event){
	//recalculate number of lines
	formatTextArea(this);
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

function clearChatMessages(){
	mainChatView.innerHTML = "";
}
function restoreChatMessages(msgArray){
	msgArray?.forEach((msg) => {
		if (!msg.content) return;
		if (msg.role == "user"){
			createNewChatPrompt(msg.content, msg).attach();
		}else if (msg.role == "assistant"){
			createNewChatAnswer(msg.content, msg).attach();
		}
	});
}
function createNewChatAnswer(message, options){
	var cb = createGeneralChatBubble(options);
	cb.c.classList.add("assistant-reply");
	cb.senderName.textContent = "SEPIA";
	cb.senderIcon.innerHTML = '<svg fill="none" viewBox="0 0 600 600"><use xlink:href="#svg-sepia"></use></svg>';
	if (message){
		cb.setText(message);	//TODO: improve to parse code etc.
	}
	return cb;
}
function createNewChatPrompt(message, options){
	var cb = createGeneralChatBubble(options);
	cb.c.classList.add("user-prompt");
	cb.senderName.textContent = "User";
	cb.senderIcon.innerHTML = '<svg viewBox="0 0 45.532 45.532"><use xlink:href="#svg-profile"></use></svg>';
	if (message){
		cb.setText(message);	//TODO: improve to parse code etc.
	}
	return cb;
}
function createGeneralChatBubble(options){
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
	timeEle.className = "date-time";
	var ts = options?.timestamp || Date.now();
	var d = new Date(ts);
	if ((Date.now() - ts) < (24*60*60*1000)){
		timeEle.textContent = d.toLocaleTimeString();
	}else{
		timeEle.textContent = d.toLocaleDateString() + ", " + d.toLocaleTimeString();
	}
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
	var paragraphsAndCode = [];
	var codeMode = false;
	c.appendChild(cm);
	cm.appendChild(h);
	cm.appendChild(loaderC);
	cm.appendChild(tb);
	cm.appendChild(footer);
	tb.appendChild(textEle);
	var thisObj = {
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
		processText: function(t){
			if (paragraphsAndCode.length == 1){
				//handle first input
				t = t.replace(/^[\r\n]+/m, "").replace(/^\s*/, "");
				//console.error("first para.:", t);	//DEBUG
			}
			/* TODO: recognize code
			if (t.startsWith("```")){
				codeMode = true;
				console.error("Code mode: " + codeMode);	//DEBUG
			}
			if (codeMode && t.endsWith("```")){
				codeMode = false;
				console.error("Code mode: " + codeMode);	//DEBUG
			}*/
			return t;
		},
		setText: function(t){
			if (!activeTextParagraph){
				thisObj.addText(t);
			}else{
				//console.error("setText:", t);	//DEBUG
				activeTextParagraph.textContent = thisObj.processText(t);
				scrollToNewText(true);
			}
		},
		addText: function(t){
			var textBox = document.createElement("div");
			textBox.className = "chat-msg-txt-p";
			textEle.appendChild(textBox);
			activeTextParagraph = textBox;
			paragraphsAndCode.push(textBox);
			//console.error("addText:", t);		//DEBUG
			textBox.textContent = thisObj.processText(t);
			scrollToNewText(true);
		},
		clearText: function(){
			textEle.innerHTML = "";
			paragraphsAndCode = [];
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
			textEle.appendChild(cmdBox);
			paragraphsAndCode.push(cmdBox);
			cmdBox.textContent = JSON.stringify(cmdJson, null, 2);
			activeTextParagraph = undefined;	//reset
			scrollToNewText(true);
		},
		attach: function(){
			mainChatView.appendChild(c);
			scrollToNewText(false);
		}
	};
	return thisObj;
}

function scrollToNewText(checkPos){
	setTimeout(function(){
		/* NOTE: tried to make scroll smarter, but doesn't really work yet ^^
		if (checkPos){
			if (mainChatView.scrollTop == lastAutoScrollPosEnd){
				mainChatView.scrollTop = mainChatView.scrollHeight;
				lastAutoScrollPosEnd = mainChatView.scrollHeight;
			}
		}else{
			mainChatView.scrollTop = mainChatView.scrollHeight;
			lastAutoScrollPosEnd = mainChatView.scrollHeight;
		}*/
		mainChatView.scrollTop = mainChatView.scrollHeight;
	}, 0);
}
var lastAutoScrollPosEnd = undefined;

//------- API interface ---------

//format prompt before sending
function formatPrompt(slotId, textIn, template, sysPrompt){
	var formText = buildSystemPrompt(template, sysPrompt);
	formText += buildPromptHistory(slotId, template);
	//formText += template.user.replace("{{CONTENT}}", textIn);		//NOTE: we've already added this to the history
	if (template.endOfPromptToken){
		formText += template.endOfPromptToken;
	}
	return formText;
}
function buildSystemPrompt(template, sysPrompt){
	return (template.system?.replace("{{INSTRUCTION}}", sysPrompt) || "");
}
function buildPromptHistory(slotId, template){
	var hist = chat.history.get(slotId);
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
	var doStream = llm.settings.getStreamResultsEnabled();
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
		var reqBody = {
			id_slot: slotId,
			stream: doStream,
			prompt: formatPrompt(slotId, textIn, template, llm.settings.getActiveSystemPrompt()),
			cache_prompt: llm.settings.getPromptCachingOnServer(),
			stop: template.stopSignals || chatTemplateStopSignalsAll,
			t_max_predict_ms: 30000			//TODO: we stop predicting after 30s. Track this timer!
			/*
			n_predict: 64,
			temperature: 0.3,
			top_k: 40,
			top_p: 0.9,
			n_keep: n_keep,
			grammar
			*/
		};
		//TODO: add specific model settings
		var response = await fetch(endpointUrl, {
			method: 'POST',
			body: JSON.stringify(reqBody)
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
		var answer = await processStreamData(response, doStream, chatEle, completionAbortCtrl);
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
function chatCompletionSystemPromptOnly(slotId, template, newPrompt){
	var endpointUrl = API_URL + "completion";
	var sysPrompt = (newPrompt != undefined)? newPrompt : llm.settings.getActiveSystemPrompt();
	return fetch(endpointUrl, {
		method: 'POST',
		keepalive: true,		//NOTE: make sure this completes when the user closes the window
		body: JSON.stringify({
			id_slot: slotId,
			stream: false,
			prompt: buildSystemPrompt(template, sysPrompt),
			cache_prompt: true,
			stop: template.stopSignals || chatTemplateStopSignalsAll,
			t_max_predict_ms: 60000,			//TODO: we stop predicting after 30s. Track this timer!
			n_predict: 2,
		})
	});
}
//trigger abort controller
var abortCompletion = function(){};		//NOTE: dynamically assigned

//get data from '/props' endpoint
function getServerProps(softFail){
	var endpointUrl = API_URL + "props";
	return callLlmServerFunction(endpointUrl, "GET", undefined, "FailedToLoadLlmServerInfo", softFail);
}
function getServerSlots(softFail){
	var endpointUrl = API_URL + "slots";
	return callLlmServerFunction(endpointUrl, "GET", undefined, "FailedToLoadLlmServerSlots", softFail);
}
async function getFreeServerSlot(numberOfSlots){
	if (numberOfSlots == 0) return -1;
	var freeSlotId;
	var serverSlots = await getServerSlots(true);
	if (serverSlots?.error){
		console.error("Unable to load LLM server slot info.", serverSlots.error);
		return -1;
	}else{
		//use data to find free slot
		for (const slot of serverSlots){
			let recentlyUsed = !!slot.prompt;
			let isProcessing = (slot.state == 1);
			if (!isProcessing && !recentlyUsed){
				freeSlotId = slot.id;
				break;
			}
		}
		return freeSlotId;
	}
}
function freeServerSlot(slotId){
	//TODO: not working? we just overwrite then
	//var endpointUrl = API_URL + "slots/" + encodeURIComponent(slotId) + "?action=erase";
	//return callLlmServerFunction(endpointUrl, "POST", undefined, "FailedToLoadLlmServerSlots", true);
	var activeTemplate = llm.settings.getChatTemplate();
	return chatCompletionSystemPromptOnly(slotId, {system: "{{INSTRUCTION}}", stopSignals: activeTemplate?.stopSignals}, "")
	.then((response) => {
		return response.json();
	});
}
function callLlmServerFunction(endpointUrl, method, bodyJson, failErrorName, softFail){
	return new Promise((resolve, reject) => {
		var fetchOptions = {
			method: method
		}
		if (bodyJson){
			fetchOptions.body = JSON.stringify(bodyJson);
		}
		fetch(endpointUrl, fetchOptions).then((response) => {
			if (!response.ok){
				//console.error("Failed to get server response:", response);		//DEBUG
				throw {
					name: failErrorName, 
					message: ("Failed to get server response. Status: " + response.status + " - " + response.statusText),
					status: response.status,
					cause: response
				};
			}
			return response.json();
		})
		.then((props) => {
			resolve(props);
		})
		.catch((err) => {
			if (softFail){
				resolve({
					error: err
				});
			}else if (err?.name == failErrorName){
				reject(err);
			}else{
				reject({
					name: failErrorName, 
					message: ("Failed to get server data."),
					cause: err
				});
			}
		});
	});
}

async function processStreamData(response, isStream, chatEle, completionAbortCtrl){
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
						let res = handleParsedMessage(message, answer, chatEle);
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
					let res = handleParsedMessage(message, answer, chatEle);
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
			let res = handleParsedMessage(message, answer, chatEle);
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
function handleParsedMessage(message, answer, chatEle){
	if (message.timings){
		console.log("time to process prompt (ms):", message.timings?.prompt_ms);		//DEBUG
		console.log("time to generate answer (ms):", message.timings?.predicted_ms);	//DEBUG
	}
	let slotId = message.id_slot;
	let expectedSlotId = llm.settings.getActiveServerSlot();
	if (slotId != expectedSlotId && expectedSlotId != -1){
		console.error("Wrong slot ID - Expected: " + expectedSlotId, "saw:", slotId);	//DEBUG
		chatEle.setFooterText("SERVER SLOT ISSUE");
		return {break: true};
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
		var expectSepiaJson = llm.settings.getSepiaJsonFormat();
		if (expectSepiaJson){
			//try to clean up in advance (Gemma-2 2B has some issues here for example)
			ans = ans.replace(/^(```json)/, "").replace(/^[\n]/, "");
			ans = ans.replace(/(```)$/, "").replace(/[\n]$/, "");
		}
		if (ans.startsWith("{") && ans.endsWith("}")){
			try {
				//TODO: this can fail for example if quotes where used inside the JSON message (not escaped \")
				ansJson = JSON.parse(ans);
				chat.history.add(slotId, "assistant", JSON.stringify(ansJson));
			}catch(err){
				console.error("Failed to handle answer while trying to parse:", ans);		//DEBUG
				ansJson = {"error": "Failed to handle answer while trying to parse JSON"};
			}
		}else{
			ansJson = {command: "chat", message: ans};	//NOTE: this will recover text if SEPIA JSON was expected but LLM decided to ignore it
			if (expectSepiaJson){
				chat.history.add(slotId, "assistant", JSON.stringify(ansJson));
			}else{
				chat.history.add(slotId, "assistant", ans);
			}
		}
		if (ansJson.command == "chat"){
			chatEle.addText(ansJson.message);
		}else{
			chatEle.addCommand(ansJson);
		}
	});
}

//export for UI
window.toggleNavMenu = toggleNavMenu;
window.toggleOptionsMenu = toggleOptionsMenu;
window.createNewChat = createNewChat;
window.editChatHistory = editChatHistory;
window.closeChat = closeChat;
window.startChat = startChat;
window.isChatClosed = function(){ return chatIsClosed; };

//initialize
ui.components.setup({
	isChatClosed: function(){ return chatIsClosed; },
	clearChatMessages: clearChatMessages
});
chat.history.setup({
	clearChatMessages: clearChatMessages,
	restoreChatMessages: restoreChatMessages
});
llm.settings.setup(optionsMenu, {		//NOTE: optionsMenu is defined in common.js
	showSystemPromptEditor: ui.components.showSystemPromptEditor
});
onPageReady();
