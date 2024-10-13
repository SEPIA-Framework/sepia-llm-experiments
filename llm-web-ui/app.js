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
const mainChatView = document.getElementById("main-chat-view");
const chatMessageBaseLineHeight = 17;

var chatSlotIdEle = optionsMenu.querySelector("[name=option-chat-slot-id]");
var chatHistoryMaxEle = optionsMenu.querySelector("[name=option-chat-history-max]");
var chatTemplateEle = optionsMenu.querySelector("[name=option-chat-template]");
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
			var baseModel = model.match(/(tiny|gemma|mistral|llama)/gi);	//TODO: add more/fix when templates grow
			if (baseModel){
				console.log("Server model family: " + baseModel[0]);
				var possibleTemplateMatch = chatTemplates.find(t => t.name.toLowerCase().indexOf(baseModel[0].toLowerCase()) >= 0);
				if (possibleTemplateMatch){
					chatTemplateEle.value = possibleTemplateMatch.name;
				}
			}
		}
		if (serverInfo?.system_prompt){
			if (serverInfo.system_prompt.indexOf("your name is SEPIA") >= 0){
				expectSepiaJsonEle.checked = true;
			}else{
				expectSepiaJsonEle.checked = false;
			}
		}
		console.log("Expect SEPIA JSON:", expectSepiaJsonEle.checked);
		if (!serverInfo?.total_slots || serverInfo.total_slots === 1){
			//disable slot ID if none or only 1 is available
			chatSlotIdEle.value = 0;
			chatSlotIdEle.max = 0;
			chatSlotIdEle.disabled = true;
		}else{
			chatSlotIdEle.max = (serverInfo.total_slots - 1);
		}
		console.log("LLM server slots:", +chatSlotIdEle.max + 1);
		//continue
		isInitialized = true;
		while (initBuffer.length){
			var next = initBuffer.shift();
			if (typeof next == "function") next();
		}
	}).catch((err) => {
		isInitialized = true;
		console.error("Unable to contact the LLM server.", err);
		showPopUp("ERROR: Unable to contact the LLM server. Please double-check if your server is running and reachable, then reload this page.");
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
	
	createNewChatAnswer("Hello world :-)").attach();
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

var activeModel = "";
var activeTemplate = undefined;
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
			cache_prompt: cachePromptsOnServer
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
//get data from '/props' endpoint
async function getServerProps(){
	var endpointUrl = API_URL + "props";
	const response = await fetch(endpointUrl, {
        method: 'GET'
    });
    if (!response.ok){
		console.error("Failed to get server info:", response);		//DEBUG
        throw new Error("Failed to get server info.", {cause: response.statusText});
    }
    var props = await response.json();
	return props;
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

//----- chat templates ------

const chatTemplates = [{
	name: "LLaMA_3.1_8B_Instruct",
	system: "<|start_header_id|>system<|end_header_id|>{{INSTRUCTION}}<|eot_id|>",
	user: "<|start_header_id|>user<|end_header_id|>{{CONTENT}}<|eot_id|>",
	assistant: "<|start_header_id|>assistant<|end_header_id|>{{CONTENT}}<|eot_id|>",
	endOfPromptToken: "assistant",
	stopSignals: ["<|eot_id|>"]
},{
	name: "Mistral-7B-Instruct",
	system: "<s>[INST] {{INSTRUCTION}} [/INST] </s>",
	user: "<s>[INST] {{CONTENT}} [/INST]",
	assistant: "{{CONTENT}}</s>",
	endOfPromptToken: "",
	stopSignals: ["</s>"]
},{
	name: "Gemma-2-it",
	system: "<start_of_turn>user\n\n{{INSTRUCTION}}\n\n <end_of_turn>",
	user: "<start_of_turn>user\n\n{{CONTENT}}<end_of_turn>",
	assistant: "<start_of_turn>model\n\n{{CONTENT}}<end_of_turn>",
	endOfPromptToken: "<start_of_turn>model",
	stopSignals: ["<end_of_turn>"]
},{
	name: "TinyLlama_1.1B_Chat",
	system: "<|system|>\n\n{{INSTRUCTION}}<|endoftext|>",
	user: "<|user|>\n\n{{CONTENT}}<|endoftext|>",
	assistant: "<|assistant|>\n\n{{CONTENT}}<|endoftext|>",
	endOfPromptToken: "<|assistant|>",
	stopSignals: ["</s>", "<|endoftext|>"]
}];
//["</s>", "<|end|>", "<|eot_id|>", "<|end_of_text|>", "<|im_end|>", "<|EOT|>", "<|END_OF_TURN_TOKEN|>", "<|end_of_turn|>", "<|endoftext|>", "assistant", "user"]

//add templates to selector
chatTemplates.forEach(tmpl => {
	var opt = document.createElement("option");
	opt.textContent = tmpl.name;
	opt.value = tmpl.name;
	chatTemplateEle.appendChild(opt);
});

//initialize
onPageReady();