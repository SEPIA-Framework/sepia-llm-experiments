//DOM elements
const inputFormEles = document.querySelectorAll(".chat-input-form");
inputFormEles.forEach((ele) => {
	ele.addEventListener("submit", onInputFormSubmit);
});
const textInputEle = document.getElementById('chat-input-text');
const textInputEleBaseHeight = +window.getComputedStyle(textInputEle).height.replace("px", "");
const textInputEleBaseLineHeight = +window.getComputedStyle(textInputEle).lineHeight.replace("px", "");
textInputEle.value = "";
textInputEle.style.height = textInputEleBaseHeight + "px";		//set start value as inline style
const mainChatView = document.getElementById("main-chat-view");
const chatMessageBaseLineHeight = 17;

var chatSlotIdEle = optionsMenu.querySelector("[name=option-chat-slot-id]");
var chatHistoryMaxEle = optionsMenu.querySelector("[name=option-chat-history-max]");

//Server static stuff
const API_URL = window.location.origin + window.location.pathname;		//NOTE: the page is hosted directly from the server

//create/close chat
function startChat(){
	contentPage.classList.remove("empty");
	contentPage.classList.add("single-instance");
	
	activeTemplate = chatTemplates.find(t => t.name == activeModel);
	activeSlotId = +chatSlotIdEle.value;
	maxHistory = +chatHistoryMaxEle.value;
	console.log("Starting chat.", "Model: " + activeModel, "Slot ID: " + activeSlotId);
	console.log("Template:", activeTemplate);
}
function closeChat(){
	contentPage.classList.add("empty");
	contentPage.classList.remove("single-instance");
}

//send/process input
function sendInput(){
	const message = textInputEle.value;
	console.log("sendInput - prompt:", message);	//DEBUG
	textInputEle.value = '';
	textInputEle.style.height = textInputEleBaseHeight + "px";
	createNewChatPrompt(message).attach();
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
	var lines = textAreaEle.value.match(/\n/gm)?.length || 0;
	textAreaEle.style.height = (baseEleHeight + lines * baseLineHeight) + "px";
}
textInputEle.addEventListener('keydown', function(event){
	if (event.key === 'Enter'){
		event.preventDefault();
		if (event.shiftKey){
			//SHIFT + ENTER: add a new line
			//textInputEle.value += '\n';
			insertTextAtCursor(this, "\n");
			textInputEle.style.height = (+textInputEle.style.height.replace("px", "") + textInputEleBaseLineHeight) + "px";
		}else{
			//ENTER: trigger send function
			sendInput();
		}
	}else if (event.key === 'Tab'){
        event.preventDefault();
		insertTextAtCursor(this, "\t");
    }
});
textInputEle.addEventListener('input', function(event){
	//recalculate number of lines
	formatTextArea(textInputEle, textInputEleBaseHeight, textInputEleBaseLineHeight);
});

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
	var activeTextParagraph = undefined;
	c.appendChild(cm);
	cm.appendChild(h);
	cm.appendChild(tb);
	tb.appendChild(textEle);
	return {
		c, senderIcon, senderName, timeEle,
		setText: function(t){
			if (activeTextParagraph){
				activeTextParagraph.textContent = t;
			}else{
				textEle.textContent = t;
			}
			//textEle.value = t;
			//formatTextArea(textEle, chatMessageBaseLineHeight, chatMessageBaseLineHeight);
			mainChatView.scrollTop = mainChatView.scrollHeight;
		},
		addText: function(t){
			var textBox = document.createElement("div");
			textBox.className = "chat-msg-txt-p";
			textBox.textContent = t;
			textEle.appendChild(textBox);
			activeTextParagraph = textBox;
			mainChatView.scrollTop = mainChatView.scrollHeight;
		},
		clearText: function(){
			textEle.innerHTML = "";
		},
		addCommand: function(cmdJson){
			var cmdBox = document.createElement("div");
			cmdBox.className = "chat-cmd-code";
			cmdBox.textContent = JSON.stringify(cmdJson, null, 2);
			textEle.appendChild(cmdBox);
			mainChatView.scrollTop = mainChatView.scrollHeight;
		},
		attach: function(){
			mainChatView.appendChild(c);
			mainChatView.scrollTop = mainChatView.scrollHeight;
		}
	};
}


//------- API interface ---------

var activeModel = "LLaMA_3.1_8B_Instruct";
var activeTemplate = undefined;
var activeSlotId = -1;

var chatHistory = {};	//NOTE: separate histories for each slotId
var maxHistory = -1;	//-1 = whatever the model/server can handle

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
function formatPrompt(slotId, textIn, template){
	var formText = buildPromptHistory(slotId, template);
	formText += template.user.replace("{{CONTENT}}", textIn);
	if (template.endOfPromptToken){
		formText += template.endOfPromptToken;
	}
	return formText;
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
	var doStream = true;
	var chatEle = createNewChatAnswer();
	chatEle.attach();
    const response = await fetch(endpointUrl, {
        method: 'POST',
        body: JSON.stringify({
			id_slot: slotId,
			stream: doStream,
            prompt: formatPrompt(slotId, textIn, template),
			cache_prompt: true
			/*
			n_predict: 64,
            temperature: 0.2,
            top_k: 40,
            top_p: 0.9,
            n_keep: n_keep,
            cache_prompt: no_cached_prompt === "false",
            stop: ["\n### Human:"], // stop completion after generating this
            grammar
			*/
        })
    });
    if (!response.ok){
		console.error("Failed to get result from server:", response);		//DEBUG
		chatEle.setText("-- ERROR --");
        throw new Error("Failed to get result from server!", {cause: response.statusText});
    }
	//console.log("response", response);		//DEBUG

    var answer = await processStreamData(response, doStream, slotId, chatEle);
	answer = postProcessAnswerAndShow(answer, slotId, chatEle);
	return answer;
}

async function processStreamData(response, isStream, expectedSlotId, chatEle){
    const reader = response.body.getReader();
    let decoder = new TextDecoder('utf-8');
    let answer = "";
    let slotId;
	if (isStream){
		let chunkLimit = 2000;
		let chunksProcessed = 0;
		while (chunksProcessed < chunkLimit){
			chunksProcessed++;
			let isLastChunk = chunksProcessed < chunkLimit;
			const {done, value} = await reader.read();
			if (done){
				console.log("processStreamData: done", value); //DEBUG
				break;
			}
			const t = decoder.decode(value, {stream: true});
			if (t.startsWith('data: ')){			
				//NOTE: sometimes 'data' can exists twice in one chunk !?
				var dataArr = t.split(/(?:\r\n|\n)/g);
				var didBreak = false;
				//console.log("dataArr:", dataArr);			//DEBUG
				dataArr.forEach(function(d){
					if (d && d.trim()){
						var data = d.substring(6).trim();
						if (data){
							const message = JSON.parse(data);
							console.log("message JSON:", message);		//DEBUG
							if (message.timings){
								console.log("time to process prompt (ms):", message.timings?.prompt_ms);		//DEBUG
								console.log("time to generate answer (ms):", message.timings?.predicted_ms);	//DEBUG
							}
							slotId = message.id_slot;
							if (slotId != expectedSlotId){
								if (expectedSlotId == -1){
									activeSlotId = expectedSlotId;
								}else{
									console.error("Wrong slot ID - Expected: " + expectedSlotId, "saw:", slotId);	//DEBUG
									didBreak = true;
									return;
								}
							}
							answer += message.content;
							chatEle.setText(answer);
							//console.log("processStreamData:", message.content); //DEBUG
							if (message.stop){
								if (message.truncated){
									//chatHistory[slotId].shift();
									console.error("TODO: message is truncated");	//DEBUG
								}
								didBreak = true;
								return;
							}
						}
					}
				});
				if (didBreak){
					break;
				}
			}
			if (isLastChunk){
				//TODO: clean up
			}
		}
	}else{
		const result = await reader.read();
		console.log("processStreamData: result", result); //DEBUG
	}
	return answer;
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
		if (ans.startsWith("{") && ans.endsWith("}")){
			try {
				ansJson = JSON.parse(ans);
				addToHistory(slotId, "assistant", JSON.stringify(ansJson));
			}catch(err){
				console.error("Failed to handle answer while trying to parse:", ans);		//DEBUG
			}
		}else{
			ansJson = {command: "chat", message: ans};
			addToHistory(slotId, "assistant", JSON.stringify(ansJson));
		}
		if (ansJson.command == "chat"){
			chatEle.addText(ansJson.message);
		}else{
			chatEle.addCommand(ansJson);
		}
	});
}

//----- chat templates ------

const chatTemplates = [{
	name: "LLaMA_3.1_8B_Instruct",
	system: "<|start_header_id|>system<|end_header_id|>{{INSTRUCTION}}<|eot_id|>",
	user: "<|start_header_id|>user<|end_header_id|>{{CONTENT}}<|eot_id|>",
	assistant: "<|start_header_id|>assistant<|end_header_id|>{{CONTENT}}<|eot_id|>",
	endOfPromptToken: "assistant",
	stopSignals: ["<|eot_id|>", "assistant", "user"]
}];
//["</s>", "<|end|>", "<|eot_id|>", "<|end_of_text|>", "<|im_end|>", "<|EOT|>", "<|END_OF_TURN_TOKEN|>", "<|end_of_turn|>", "<|endoftext|>", "assistant", "user"]