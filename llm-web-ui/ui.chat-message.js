import * as llmInterface from "./llm.interface.js"

var llm = {
	interface: llmInterface
}

//handlers to check and manipulate main UI (see app.js)
var chatUiHandlers;

export function setup(chatUiHandl){
	return new Promise((resolve, reject) => {
		//getMainChatView, showAbortButton, hideAbortButton, scrollToNewText
		chatUiHandlers = chatUiHandl;
		resolve();
	});
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
	var codeLevel = 0;
	c.appendChild(cm);
	cm.appendChild(h);
	cm.appendChild(loaderC);
	cm.appendChild(tb);
	cm.appendChild(footer);
	tb.appendChild(textEle);
	var textBuffer = "";			//buffer for active paragraph
	var linesBuffer = [];			//buffer each (completed) line of paragraph
	var activeLineBuffer = "";		//buffer for active line (of paragraph)
	function setTextBuffer(t){
		textBuffer = t;
		if (/\n/.test(t)){
			linesBuffer = textBuffer.split(/[\r\n]/);
			activeLineBuffer = linesBuffer.pop();
		}else{
			activeLineBuffer = t;
		}
	}
	function addTokensToTextBuffer(t, newLineCallback){
		activeLineBuffer += t;
		//console.error("activeLineBuffer:", activeLineBuffer);	//DEBUG
		if (/\n/.test(t)){
			//due to pre-processing, we can assume that the line-break can only be the last token
			let completedLine = activeLineBuffer.split(/[\n]/).shift();
			//console.error("-- NEW LINE:", completedLine);	//DEBUG
			activeLineBuffer = "";
			if (newLineCallback){
				let {removeFormatTagLine} = newLineCallback(completedLine);
				if (removeFormatTagLine){
					//TODO: remove line if it was a format tag and restore textBuffer from linesBuffer
					console.error("remove format tag -- linesBuffer:\n", JSON.stringify(linesBuffer, null, 2), "-- textBuffer:\n", textBuffer);	//DEBUG
				}
				linesBuffer.push(completedLine);
				textBuffer += t;
			}else{
				linesBuffer.push(completedLine);
				textBuffer += t;
			}
		}else{
			textBuffer += t;
		}
		return textBuffer;
	}
	function processText(t){
		if (paragraphsAndCode.length === 0){
			//handle first input
			//console.error("first para.:", t);	//DEBUG
			t = t.replace(/^[\r\n]+/m, "").replace(/^\s*/, "");
		}
		return t;
	}
	function processFormatTags(t){
		var removeFormatTagLine = false;
		var codeStyle;
		var isCodeStart = false;
		var isCodeEnd = false;
		//recognize JSON
		//if (t.startsWith('{"') && t.endsWith('}')){ ... }
		//recognize code
		var codeTagsMatch = t.match(/^(```)(?<name>\w+|)(\r\n|\n|$)/);
		if (!!codeTagsMatch){
			removeFormatTagLine = true;
			if (codeTagsMatch.groups?.name === ""){
				//can be start or end of code
				if (codeMode && codeLevel > 0){
					codeLevel--;
				}else if (codeMode && codeLevel == 0){
					codeMode = false;
					isCodeEnd = true;
				}else{
					codeMode = true;
					codeLevel = 0;
					isCodeStart = true;
				}
			}else if (codeTagsMatch.groups?.name){
				//can only be start of code
				codeStyle = codeTagsMatch.groups.name;
				if (codeMode){
					codeLevel++;
				}else{
					codeMode = true;
					codeLevel = 0;
					isCodeStart = true;
				}
			}
			console.error("Code mode: " + codeMode + ", level: " + codeLevel);	//DEBUG
		}
		return {codeStyle, isCodeStart, isCodeEnd, removeFormatTagLine};
	}
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
		/**
		 * Set/overwrite the text of the active paragraph
		 */
		setText: function(t){
			thisObj.resetFormat();
			if (!activeTextParagraph){
				thisObj.addText(t);
			}else{
				t = processText(t);
				setTextBuffer(t);
				//console.error("setText:", t);	//DEBUG
				activeTextParagraph.textContent = t;
				chatUiHandlers.scrollToNewText(true);
			}
		},
		/**
		 * Stream text chunks to active paragraph. Chunks should be either tokens or
		 * one full line at most. If its more than one line, lines will be broken down.
		 */
		streamText: function(t){
			if (!activeTextParagraph){
				thisObj.resetFormat();
				thisObj.addText(t);
			}else{
				t = processText(t);
				//console.error("streamText:", t);	//DEBUG
				function add(tt){
					//add text to buffer, check for format tags and decide how to handle them
					let newTextBuffer = addTokensToTextBuffer(tt, function(completedLine){
						if (completedLine){
							let {removeFormatTagLine} = processFormatTags(completedLine);
							return {removeFormatTagLine};
						}else{
							return {removeFormatTagLine: false}
						}
					});
					activeTextParagraph.textContent = newTextBuffer;
				}
				let lines = t.split(/[\r\n]/);
				if (lines.length == 1){
					//only token(s)
					add(t);
				}else{
					//lines and tokens
					let rest = lines.pop();
					lines.forEach(function(l){
						add(l + "\n");	//NOTE: we restore the line-breaks
					});
					if (rest){
						add(rest);
					}
				}
				chatUiHandlers.scrollToNewText(true);
			}
		},
		/**
		 * Add text as new paragraph
		 */
		addText: function(t){
			t = processText(t);
			setTextBuffer(t);
			var textBox = document.createElement("div");
			textBox.className = "chat-msg-txt-p";
			textEle.appendChild(textBox);
			activeTextParagraph = textBox;
			paragraphsAndCode.push(textBox);
			//console.error("addText:", t);		//DEBUG
			textBox.textContent = t;
			chatUiHandlers.scrollToNewText(true);
		},
		resetFormat: function(){
			codeMode = false;
			codeLevel = 0;
		},
		/**
		 * Clear all paragraphs of active message
		 */
		clearText: function(){
			textEle.innerHTML = "";
			setTextBuffer("");
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