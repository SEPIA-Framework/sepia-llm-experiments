import * as llmInterface from "./llm.interface.js"

var llm = {
	interface: llmInterface
}

//handlers to check and manipulate main UI (see app.js)
var chatUiHandlers;

export function setup(chatUiHandl){
	//getMainChatView, showAbortButton, hideAbortButton, scrollToNewText
	chatUiHandlers = chatUiHandl;
}

//specific assistant answer message
export function createAnswer(message, options){
	var cb = createGenericMessage(options);
	cb.c.classList.add("assistant-reply");
	cb.senderName.textContent = "SEPIA";
	cb.senderIcon.innerHTML = '<svg fill="none" viewBox="0 0 600 600"><use xlink:href="#svg-sepia"></use></svg>';
	if (message){
		cb.setText(message);	//TODO: improve to parse code etc.
	}
	return cb;
}
//specific user prompt message
export function createPrompt(message, options){
	var cb = createGenericMessage(options);
	cb.c.classList.add("user-prompt");
	cb.senderName.textContent = "User";
	cb.senderIcon.innerHTML = '<svg viewBox="0 0 45.532 45.532"><use xlink:href="#svg-profile"></use></svg>';
	if (message){
		cb.setText(message);	//TODO: improve to parse code etc.
	}
	return cb;
}

//generic chat message
export function createGenericMessage(options){
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
				chatUiHandlers.showAbortButton();
			}
			chatUiHandlers.scrollToNewText(true);
		},
		hideLoader: function(keepGlobalAbort){
			loaderC.classList.remove("active");
			if (!keepGlobalAbort){
				chatUiHandlers.hideAbortButton();
			}
			chatUiHandlers.scrollToNewText(true);
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
				chatUiHandlers.scrollToNewText(true);
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
			chatUiHandlers.scrollToNewText(true);
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
			chatUiHandlers.scrollToNewText(true);
		},
		attach: function(){
			chatUiHandlers.getMainChatView().appendChild(c);
			chatUiHandlers.scrollToNewText(false);
		}
	};
	return thisObj;
}