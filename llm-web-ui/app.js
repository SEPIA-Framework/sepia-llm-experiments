console.log("Welcome to the SEPIA LLM Web UI :-)");

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
//menu
var chatSlotIdEle = optionsMenu.querySelector("[name=option-chat-slot-id]");
var chatHistoryMaxEle = optionsMenu.querySelector("[name=option-chat-history-max]");
var chatTemplateEle = optionsMenu.querySelector("[name=option-chat-template]");
var systemPromptEle = optionsMenu.querySelector("[name=option-system-prompt]");
var streamResultEle = optionsMenu.querySelector("[name=option-stream-result]");
var cachePromptsOnServerEle = optionsMenu.querySelector("[name=option-cache-prompts]");
var expectSepiaJsonEle = optionsMenu.querySelector("[name=option-expect-sepia-json]");

//clean up before page close (TODO: mobile might require 'visibilitychange')
window.addEventListener("beforeunload", function(e){
	cleanUpOnPageClose();
});

//Server static stuff - NOTE: the page can be hosted directly from the llama.cpp server if needed
var API_URL = getUrlParameter("llmServer") || getUrlParameter("llm_server") || (window.location.origin + window.location.pathname);
if (!API_URL.endsWith("/")) API_URL += "/";
console.log("LLM server URL:", API_URL);

var isInitialized = false;
var chatIsClosed = true;
var initBuffer = [];
var completionFinishedBuffer = [];

var llmServerSlots = 0;

var isPromptProcessing = false;

//initialize UI
function onPageReady(){
	getServerProps().then((serverInfo) => {
		console.log("Server info:", serverInfo);
		//make use of server info
		if (serverInfo?.default_generation_settings?.model){
			var model = serverInfo.default_generation_settings.model;
			var baseModel = model.match(/(tiny|olmo)/i) || model.match(/(gemma|mistral|phi|llama)/i);	//TODO: add more/fix when templates grow
			if (baseModel){
				console.log("Server model family: " + baseModel[0]);
				var possibleTemplateMatch = chatTemplates.find(t => t.name.toLowerCase().indexOf(baseModel[0].toLowerCase()) >= 0);
				if (possibleTemplateMatch){
					chatTemplateEle.value = possibleTemplateMatch.name;
				}
			}
		}
		if (!serverInfo?.total_slots || serverInfo.total_slots === 1){
			//disable slot ID if none or only 1 is available
			chatSlotIdEle.value = 0;
			chatSlotIdEle.max = 0;
			chatSlotIdEle.disabled = true;
			llmServerSlots = 1;
		}else{
			chatSlotIdEle.max = (serverInfo.total_slots - 1);
			chatSlotIdEle.value = Math.floor(Math.random() * serverInfo.total_slots);	//TODO: for now we assign a random slot
			llmServerSlots = serverInfo.total_slots;
		}
		console.log("LLM server slots:", llmServerSlots);
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
			cachePromptsOnServerEle.checked = false;
			cachePromptsOnServerEle.disabled = true;
			cachePromptsOnServerEle.title += "- NOTE: Prompt cache has been disabled due to missing slot info and to avoid issues with concurrent users.";
			console.warn("NOTE: To avoid issues with concurrent users the prompt cache has been disabled!");
			llmServerSlots = 0;		//NOTE: 0 is disabled
		}else{
			//NOTE: we check for free slots later again
		}
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
		}else if (err.name == "FailedToLoadSystemPrompt"){
			console.error("Failed to load custom system prompt.", err);
			showPopUp("ERROR: Failed to load custom system prompt. Please add your prompt via the settings.");
		}else if (err.name == "FailedToLoadLlmServerInfo"){
			console.error("Unable to contact the LLM server.", err);
			showPopUp("ERROR: Unable to contact the LLM server. Please double-check if your server is running and reachable, then reload this page.");
		}else if (err.name == "FailedToLoadLlmServerSlots"){
			//NOTE: this will only trigger when 'getServerSlots' is called with softFail = false
			console.error("Unable to load LLM server slot info.", err);
			llmServerSlots = 0;
		}else{
			console.error("Error in 'onPageReady' function:", err);
		}
		isInitialized = true;
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
	chatIsClosed = false;
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
	maxHistory = +chatHistoryMaxEle.value;
	cachePromptsOnServer = cachePromptsOnServerEle.checked;
	expectSepiaJson = expectSepiaJsonEle.checked;
		
	//check free slots
	if (llmServerSlots != 0){
		var welcomeMsg = createNewChatAnswer("");
		welcomeMsg.attach();
		welcomeMsg.showLoader(true);
		getFreeServerSlot().then((slotId) => {
			if (slotId != undefined){
				//assign free slot
				activeSlotId = slotId;
				chatSlotIdEle.value = activeSlotId;
				initNewChat(welcomeMsg, true);
			}else{
				//no free slots
				var msg = showFormPopUp([
					{label: "Sorry, but it seem there are currently no free slots available (LLM server is busy). Please try again later!"},
					{submit: true, name: "Free up slots"}
				], function(){
					closeChat().finally(() => {
						freeAllServerSlotsPopUp();
					});
				});
				activeSlotId = -1;
				chatSlotIdEle.value = activeSlotId;
				welcomeMsg.hideLoader();
				welcomeMsg.setText("I'm very busy right now. Please come back later! :-)");
				welcomeMsg.setFooterText("CHAT CLOSED");
				chatIsClosed = true;
			}
		});
	}else{
		activeSlotId = +chatSlotIdEle.value;
		initNewChat();
	}
}
function initNewChat(welcomeMsg, cacheSysPrompt){
	console.log("Starting new chat - Slot ID: " + activeSlotId + ", Max. history: " + maxHistory);
	console.log("Template:", activeTemplate.name, activeTemplate);
	toggleButtonVis(true);
	
	var welcomeMessageText = activeSystemPromptInfo.welcomeMessage || "Hello world :-)";
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
		}).catch((err) => {
			//TODO: handle
			console.error("Failed to upload system prompt:", err);		//DEBUG
		});
	}else{
		welcomeMsg.hideLoader();
		welcomeMsg.setText(welcomeMessageText);
	}
}
function closeChat(){
	contentPage.classList.add("empty");
	contentPage.classList.remove("single-instance");
	chatHistory = {};
	mainChatView.innerHTML = "";
	return new Promise((resolve, reject) => {
		if (!chatIsClosed && llmServerSlots > 0){
			//try to clean up server history
			chatIsClosed = true;
			var msg = showPopUp("Cleaning up ...");
			freeServerSlot(activeSlotId).then((res) => {
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
		showSystemPromptEditor();
	}else{
		showChatHistoryEditor();
	}
}

function freeAllServerSlotsPopUp(){
	var msg = showFormPopUp([
		{label: "Do you really want to free up all slots? This can potentially mess up the chat for other concurrent users!"},
		//{customButton: {name: "Maybe", fun: function(){ console.log("OK"); }}},
		{submit: true, name: "I know what I'm doing. Let's go!"}
	], function(formData){
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
	addToHistory(activeSlotId, "user", message);
	isPromptProcessing = true;
	chatCompletion(activeSlotId, message, activeTemplate).then(answer => {
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

function showSystemPromptEditor(){
	var content = buildSystemPromptEditComponent();
	if ((!systemPromptEle.value || systemPromptEle.value == "custom") && customSystemPrompt){
		content.setSystemPrompt(customSystemPrompt);
	}
	var buttons = [{
		name: "Save",
		fun: function(){
			systemPromptEle.value = "custom";
			customSystemPrompt = content.getSystemPrompt();
			loadSystemPrompt(systemPromptEle.value).catch((err) => {
				console.error("Failed to load system prompt.", err);
				showPopUp("ERROR: " + (err?.message || "Failed to load system prompt."));
				//TODO: reset properly
				systemPromptEle.value = systemPromptEle.options[1].value;
			});
		},
		closeAfterClick: true
	},{
		name: "Cancel",
		closeAfterClick: true
	}];
	showPopUp(content, buttons, {
		width: "512px"
	});
}
function exportSystemPromptAndHistory(){
	return {
		systemPromptSelected: systemPromptEle.value,
		systemPrompt: ((systemPromptEle.value == "custom")? customSystemPrompt : ""),
		history: getHistory(activeSlotId)
	}
}
function restoreSystemPromptAndHistory(data){
	systemPromptEle.value = data.systemPromptSelected;
	customSystemPrompt = data.systemPrompt;
	updateHistory(activeSlotId, data.history);
	return loadSystemPrompt(data.systemPromptSelected);
}
function showChatHistoryEditor(){
	var content = buildChatHistoryListComponent();
	var buttons = [{
		name: "Export",
		fun: function(){
			var data = exportSystemPromptAndHistory();
			saveAs("my-chat.txt", data);
		},
		closeAfterClick: false
	},{
		name: "Import",
		fun: function(){
			openTextFilePrompt(function(txt){
				try {
					var txtJson = JSON.parse(txt);
					restoreSystemPromptAndHistory(txtJson).then(() => {
						pop.popUpClose();
						showChatHistoryEditor();
					}).catch((err) => {
						showPopUp("Failed to load file. JSON data seems to be corrupted.");
					});
				}catch (err){
					console.error("Failed to load file. Could not parse JSON data:", err);		//DEBUG
					showPopUp("Failed to load file. Could not parse JSON data.");
				}
			}, function(err){
				console.error("Failed to load file:", err);		//DEBUG
				showPopUp("Failed to load file.");
			});
		},
		closeAfterClick: false
	},{
		name: "Close",
		closeAfterClick: true
	}];
	var pop = showPopUp(content, buttons, {
		width: "512px"
	});
}
function buildSystemPromptEditComponent(){
	var content = document.createElement("div");
	content.className = "section-wrapper";
	var info = document.createElement("p");
	info.textContent = "Here you can add/edit your system prompt:";
	var textC = document.createElement("div");
	textC.className = "text-container";
	var txt = document.createElement("textarea");
	if (!systemPromptEle.value || systemPromptEle.value == "custom"){
		txt.placeholder = ("Enter your prompt here.");
	}else{
		txt.placeholder = ("Currently selected preset:\n" + systemPromptEle.value);
	}
	content.appendChild(info);
	content.appendChild(textC);
	textC.appendChild(txt);
	content.getSystemPrompt = function(){
		return txt.value;
	};
	content.setSystemPrompt = function(newVal){
		txt.value = newVal;
	};
	return content;
}
function buildChatHistoryListComponent(){
	var content = document.createElement("div");
	content.className = "section-wrapper";
	var info = document.createElement("p");
	info.textContent = "Here you can edit your chat history:";
	var list = document.createElement("div");
	list.className = "list-container";
	content.appendChild(list);
	var slotHistory = getHistory(activeSlotId);
	if (!slotHistory?.length){
		list.innerHTML = "<p style='text-align: center;'>- no history yet -</p>";
		return content;
	}
	slotHistory.filter((itm) => { return itm.role != "removed" }).forEach(function(entry, i){
		var item = document.createElement("div");
		item.className = "list-item history-entry";
		var wrap = document.createElement("div");
		wrap.className = "entry-wrapper";
		var header = document.createElement("div");
		header.className = "entry-header";
		var role = document.createElement("span");
		if (entry.role == "user") role.className = "role-user";
		else if (entry.role == "assistant") role.className = "role-assistant";
		role.textContent = entry.role;
		var timestamp = document.createElement("span");
		timestamp.className = "chat-hist-time";
		timestamp.textContent = new Date(entry.timestamp || Date.now()).toLocaleString();
		header.appendChild(role);
		header.appendChild(timestamp);
		var previewTxt = document.createElement("div");
		previewTxt.className = "list-item-desc";
		previewTxt.setAttribute("tabindex", "0");
		previewTxt.addEventListener("click", function(){
			var pop = showTextEditor(entry.content, {
				intro: "Here you can edit your history:",
				placeholder: "Your chat history",
				width: "512px"
			}, function(newTxt){
				entry.content = newTxt;
				prevTxtSpan.textContent = newTxt;
			});
		});
		var prevTxtSpan = document.createElement("span");
		prevTxtSpan.textContent = entry.content;
		previewTxt.appendChild(prevTxtSpan);
		wrap.appendChild(header);
		wrap.appendChild(previewTxt);
		var removeBtn = document.createElement("button");
		removeBtn.innerHTML = '<svg viewBox="0 0 16 16" style="width: 14px; fill: currentColor;"><use xlink:href="#svg-minus-btn"></use></svg>';
		removeBtn.addEventListener("click", function(){
			entry.role = "removed";
			entry.content = "";
			item.remove();
		});
		item.appendChild(wrap);
		item.appendChild(removeBtn);
		list.appendChild(item);
	});
	return content;
}

//------- API interface ---------

var activeModel = "";
var activeTemplate = undefined;
var activeSystemPrompt = "";
var customSystemPrompt = "";
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
		content: content,
		timestamp: Date.now()
	});
	//remove first element?
	if (maxHistory > -1 && chatHistory.length > maxHistory){
		chatHistory.shift();
	}
}
function getHistory(slotId){
	return chatHistory[slotId].filter((itm) => { return itm.role != "removed" }) || [];
}
function updateHistory(slotId, newHist){
	chatHistory[slotId] = newHist;
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
				stop: template.stopSignals || chatTemplateStopSignalsAll,
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
function chatCompletionSystemPromptOnly(slotId, template, newPrompt){
	var endpointUrl = API_URL + "completion";
	var sysPrompt = (newPrompt != undefined)? newPrompt : activeSystemPrompt;
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
	if (numberOfSlots == 0) return;
	var freeSlotId;
	var serverSlots = await getServerSlots(true);
	if (serverSlots?.error){
		console.error("Unable to load LLM server slot info.", err);
		return;
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
			activeSlotId = expectedSlotId;		//TODO: in this case we need to manage the input history
		}else{
			console.error("Wrong slot ID - Expected: " + expectedSlotId, "saw:", slotId);	//DEBUG
			chatEle.setFooterText("SERVER SLOT ISSUE");
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
	name: "OLMo_7B_Instruct",
	llmInfo: {
		infoPrompt: "Your LLM is called OLMo, has 7B parameters, works offline, on device, is open and may be used commercially under certain conditions. OLMo is trained in a very transparent way by the Allen Institute for AI with open data."
	},
	system: "<|system|>\n\n{{INSTRUCTION}}<|endoftext|>",
	user: "<|user|>\n\n{{CONTENT}}<|endoftext|>",
	assistant: "<|assistant|>\n\n{{CONTENT}}<|endoftext|>",
	endOfPromptToken: "<|assistant|>",
	stopSignals: ["</s>", "<|endoftext|>"]
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
var chatTemplateStopSignalsAll = ["</s>", "<|end|>", "<|eot_id|>", "<|end_of_text|>", "<|im_end|>", "<|EOT|>", "<|END_OF_TURN_TOKEN|>", "<|end_of_turn|>", "<|endoftext|>", "assistant", "user"];

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
},{
	name: "Custom System Prompt",
	value: "custom",
	promptText: "",
	welcomeMessage: "Hello World.",
	expectSepiaJson: false,
	promptVariables: []
}];

//add prompts to selector
systemPrompts.forEach((sp, index) => {
	var opt = document.createElement("option");
	opt.textContent = sp.name;
	opt.value = (sp.value != undefined)? sp.value : sp.name;
	if (index == 0) opt.selected = true;
	systemPromptEle.appendChild(opt);
});
//load prompts via selector
systemPromptEle.addEventListener("change", function(){
	loadSystemPrompt(systemPromptEle.value).catch((err) => {
		if (err.name == "FailedToLoadSystemPrompt"){
			console.error("Failed to load system prompt.", err);
			showPopUp("ERROR: " + (err?.message || "Failed to load system prompt."));
		}else{
			console.error("Failed to load system prompt file.", err);
			showPopUp("ERROR: " + (err?.message || "Failed to load system prompt file."));
		}
		//TODO: reset properly
		systemPromptEle.value = systemPromptEle.options[1].value;
	});
});
//prompt loader
function loadSystemPrompt(name){
	return new Promise((resolve, reject) => {
		var sysPromptInfo = systemPrompts.find((sp) => sp.value == name || sp.name == name);
		activeSystemPromptInfo = sysPromptInfo;
		if (name == undefined || name == "custom"){
			if (!customSystemPrompt){
				reject({
					name: "FailedToLoadSystemPrompt",
					message: "Failed to load custom system prompt. Please define via settings."
				});
			}else{
				activeSystemPrompt = customSystemPrompt;
				expectSepiaJsonEle.checked = false;
				resolve(activeSystemPrompt);
			}
		}else if (sysPromptInfo.file){
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
