import * as uiComponents from "./ui.components.js"
import * as uiChatMessage from "./ui.chat-message.js"
import * as chatHistory from "./chat.history.js"
import * as llmSettings from "./llm.settings.js"
import * as llmInterface from "./llm.interface.js"

var ui = {
	components: uiComponents,
	chatMessage: uiChatMessage,
	embeddingApi: undefined		//this will hold the imported module after setup, if embedding API is enabled
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
//main menu (page center)
var continueChatBtnMain = document.getElementById("continue-chat-main-menu-btn");

//clean up before page close (TODO: mobile might require 'visibilitychange')
window.addEventListener("beforeunload", function(e){
	cleanUpOnPageClose();
});

//Server static stuff - NOTE: the page can be hosted directly from the llama.cpp server if needed
var LLM_API_URL = getUrlParameter("llmServer") || getUrlParameter("llm_server") || (window.location.origin + window.location.pathname);
if (!LLM_API_URL.endsWith("/")) LLM_API_URL += "/";
console.log("LLM server URL:", LLM_API_URL);

var enableEmbeddingApi = getUrlParameter("embeddingApi")?.toLowerCase();
if (enableEmbeddingApi == "1" || enableEmbeddingApi == "true") enableEmbeddingApi = 1;	//NOTE: we might support more than one type later

var continueChatWhenReady = getUrlParameter("continueChat")?.toLowerCase();
if (continueChatWhenReady == "1" || continueChatWhenReady == "true") continueChatWhenReady = true;
else continueChatWhenReady = false;

var isInitialized = false;
var blockChatStart = false;
var chatIsClosed = true;
var initBuffer = [];
var startChatBuffer = [];
var completionFinishedBuffer = [];

var isPromptProcessing = false;
var initLoadingPopup = undefined;

//init events
function onUiReady(){
	console.log("Welcome to the SEPIA LLM Web UI :-)");
	if (enableEmbeddingApi){
		ui.embeddingApi.sendReadyEvent("ui-ready");
	}
}
function onServerReady(){
	console.log("SEPIA LLM server is ready.");
	if (enableEmbeddingApi){
		ui.embeddingApi.sendReadyEvent("server-ready");
	}
}
function onInitError(err){
	console.error("SEPIA LLM experienced an error during the init. phase.");
	if (enableEmbeddingApi){
		ui.embeddingApi.sendReadyEventError("init-error");
	}
}
function onChatSetupReady(){
	console.log("SEPIA LLM chat is set up and ready for input.");
	if (enableEmbeddingApi){
		ui.embeddingApi.sendReadyEvent("chat-ready");
	}
}
function onChatSetupError(err){
	console.error("SEPIA LLM chat failed to load:", err);
	if (enableEmbeddingApi){
		ui.embeddingApi.sendReadyEventError("chat-setup-error");
	}
}
function onChatClosed(){
	console.log("SEPIA LLM chat was closed.");
	if (enableEmbeddingApi){
		ui.embeddingApi.sendUiEvent("chat-closed");
	}
}

//pre-init
function preInitialization(){
	if (continueChatWhenReady){
		initLoadingPopup = showPopUp("Resuming conversation. Please wait ...");
	}
}

//initialize UI
function onPageReady(){
	onUiReady();
	llm.interface.getServerProps().then((serverInfo) => {
		//make use of server info
		var model = serverInfo?.default_generation_settings?.model || serverInfo?.model_path;
		if (model){
			var possibleTemplateMatch = llm.settings.findBestModelMatch(model);
			console.log("Using LLM template:", possibleTemplateMatch?.name || "---");		//DEBUG
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
		onServerReady();
		if (continueChatWhenReady){
			continueStoredChat();
			initLoadingPopup?.popUpClose();
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
		initLoadingPopup?.popUpClose();
		isInitialized = true;
		let initHadErrors = true;
		while (initBuffer.length){
			var next = initBuffer.shift();
			if (typeof next?.fun == "function") next.fun(initHadErrors);
		}
		blockChatStart = true;
		onInitError(err);
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

function enableContinueButtonOfMainMenu(){
	continueChatBtnMain.style.removeProperty("display");
}
function disableContinueButtonOfMainMenu(){
	continueChatBtnMain.style.display = "none";		//initially hidden - TODO: enable when history exists
}
function updateMainMenu(historySize){
	if (historySize == undefined) historySize = chat.history.getActiveHistory()?.length;
	if (historySize){
		enableContinueButtonOfMainMenu();
	}else{
		disableContinueButtonOfMainMenu();
	}
}

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
		var welcomeMsg = ui.chatMessage.createAnswer("");
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
				onChatSetupError({name: "LlmServerBusy", message: "No free LLM server slots available right now."});
			}
		});
	}else{
		//incompatible server
		showPopUp("Sorry, but it seems that your server is incompatible with this version of the app. Please make sure it supports slot management.");
		var welcomeMsg = ui.chatMessage.createAnswer("");
		welcomeMsg.attach();
		welcomeMsg.setText("Please check your server settings and make sure to enable slot management.");
		welcomeMsg.setFooterText("CHAT CLOSED");
		llm.settings.setActiveServerSlot(-1);
		startChatBuffer = [];	//TODO: remove buffered actions or keep?
		toggleButtonVis(true);
		chatIsClosed = true;
		onChatSetupError({name: "LlmServerIncompatible", message: "LLM server is incompatible with the current UI version. Please upgrade."});
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
		welcomeMsg = ui.chatMessage.createAnswer();
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
	let res = chat.history.restore();
	if (res?.restored){
		console.log("Chat history restored. Showing the last " + res.restored 
			+ " of a total of " + res.historySize + " messages.");
	}
	//have some actions buffered?
	while (startChatBuffer.length){
		var next = startChatBuffer.shift();
		if (typeof next?.fun == "function") next.fun();
	}
	onChatSetupReady();
}
function closeChat(){
	contentPage.classList.add("empty");
	contentPage.classList.remove("single-instance");
	var histSize = chat.history.getActiveHistory()?.length;
	var keepHistoryInSessionCache = true;		//NOTE: we clear the server history, but keep the session to reuse it later
	chat.history.clearAll(keepHistoryInSessionCache);
	mainChatView.innerHTML = "";
	return new Promise((resolve, reject) => {
		if (!chatIsClosed){
			setTimeout(() => onChatClosed(), 0);
			updateMainMenu(histSize);
		}
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
	//clean-up history before starting new chat
	chat.history.clearAll(false);
	continueStoredChat();
}
function continueStoredChat(){
	if (isPromptProcessing){
		showPopUp("Your input is still being processed. Please wait a few seconds until the chat has finished.");
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
		ui.components.showSystemPromptEditor(undefined, function(){
			//closed - update main menu buttons
			updateMainMenu();
		});
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
	var newChatMsg = ui.chatMessage.createPrompt(message);
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
			ui.chatMessage.createPrompt(msg.content, msg).attach();
		}else if (msg.role == "assistant"){
			ui.chatMessage.createAnswer(msg.content, msg).attach();
		}
	});
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
window.continueStoredChat = continueStoredChat;
window.editChatHistory = editChatHistory;
window.closeChat = closeChat;
window.startChat = startChat;
window.isChatClosed = function(){ return chatIsClosed; };

//pre-init
preInitialization();

//initialize
Promise.resolve(() => {
	console.log("Initializing SEPIA LLM interface ...");
}).then(() => {
	//Load embedding module
	if (enableEmbeddingApi == 1){
		//load postMessage interface
		console.log("Importing embedding API module ...");
		return import("./ui.embedding-api.js");
	}else{
		return;
	}
}).then(embedModule => {
	//assign embed API
	if (embedModule && embedModule.sendReadyEvent){
		ui.embeddingApi = embedModule;
		return ui.embeddingApi.setup(parent);	//NOTE: for now we assume 'parent' is the correct window
	}else{
		ui.embeddingApi = undefined;
	}
}).then(res => {
	//Components
	return ui.components.setup({
		//chatUiHandlers
		isChatClosed: function(){ return chatIsClosed; },
		clearChatMessages: clearChatMessages,
		restoreChatMessages: restoreChatMessages
	});
}).then(res => {
	//UI messages
	return ui.chatMessage.setup({
		//chatUiHandlers
		isChatClosed: function(){ return chatIsClosed; },
		getMainChatView: function(){
			return mainChatView;
		},
		showAbortButton: showAbortButton,
		hideAbortButton: hideAbortButton,
		scrollToNewText: scrollToNewText
	});
}).then(res => {
	//Chat history
	return chat.history.setup({
		//chatUiHandlers
		isChatClosed: function(){ return chatIsClosed; },
		clearChatMessages: clearChatMessages,
		restoreChatMessages: restoreChatMessages
	});
}).then(res => {
	//LLM settings
	return llm.settings.setup(optionsMenu, {		//NOTE: optionsMenu is defined in common.js
		showSystemPromptEditor: ui.components.showSystemPromptEditor
	});
}).then(res => {
	//LLM interface
	return llm.interface.setup(LLM_API_URL);
})
.then(() => {
	//READY
	updateMainMenu();
	onPageReady();
})
//ERROR
.catch(err => {
	showPopUp("ERROR: Failed to initialize app.<br><br>" 
		+ "Name: " + (err?.name || "unknown") + "<br>"
		+ "Message: " + (err?.message || "undefined")
	);
});
