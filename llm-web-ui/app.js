import * as uiComponents from "./ui.components.js"
import * as chatHistory from "./chat.history.js"
import * as llmSettings from "./llm.settings.js"
import * as llmInterface from "./llm.interface.js"

var ui = {
	components: uiComponents
}
var chat = {
	history: chatHistory
}
var llm = {
	settings: llmSettings,
	interface: llmInterface
}
//export for testing
/*
window.ui = ui;
window.chat = chat;
window.llm = llm;
*/

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
var LLM_API_URL = getUrlParameter("llmServer") || getUrlParameter("llm_server") || (window.location.origin + window.location.pathname);
if (!LLM_API_URL.endsWith("/")) LLM_API_URL += "/";
console.log("LLM server URL:", LLM_API_URL);

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
	llm.interface.getServerProps().then((serverInfo) => {
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
		return llm.interface.getServerSlots(true);	//NOTE: is soft-fail = will not throw error for catch
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
			//NOTE: this will only trigger when 'llm.interface.getServerSlots' is called with softFail = false
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
		llm.interface.getFreeServerSlot(numOfSlots).then((slotId) => {
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
		llm.interface.chatCompletionSystemPromptOnly(activeSlotId, activeTemplate).then((response) => {
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
			llm.interface.freeServerSlot(llm.settings.getActiveServerSlot()).then((res) => {
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
		//llm.interface.abortChatCompletion();
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
	llm.interface.abortChatCompletion();
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
				sfpa.push(llm.interface.freeServerSlot(i));
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
	llm.interface.chatCompletion(llm.settings.getActiveServerSlot(), message, llm.settings.getChatTemplate()).then(answer => {
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
	llm.interface.abortChatCompletion();
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
		llm.interface.abortChatCompletion();
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

//----------------------------------

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
	clearChatMessages: clearChatMessages,
	restoreChatMessages: restoreChatMessages
});
chat.history.setup({
	isChatClosed: function(){ return chatIsClosed; },
	clearChatMessages: clearChatMessages,
	restoreChatMessages: restoreChatMessages
});
llm.settings.setup(optionsMenu, {		//NOTE: optionsMenu is defined in common.js
	showSystemPromptEditor: ui.components.showSystemPromptEditor
});
llm.interface.setup(LLM_API_URL, {
	createNewChatAnswer: createNewChatAnswer
});
onPageReady();
