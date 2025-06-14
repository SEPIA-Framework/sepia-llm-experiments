//----- chat templates and system prompts ------

//DOM elements - NOTE: currently we require these 'select/input' elements (can be further abstracted)
var chatSlotIdEle = undefined;
var chatHistoryMaxEle = undefined;
var chatTemplateEle = undefined;
var systemPromptEle = undefined;
var streamResultEle = undefined;
var cachePromptsOnServerEle = undefined;
var expectSepiaJsonEleOrObj = undefined;

//TODO: resolve
var customSystemPrompt = undefined;
var activeSystemPrompt = undefined;
var llmServerSlots = 0;

export function setup(optionsMenu, injectedFun){
	return new Promise((resolve, reject) => {
		chatSlotIdEle = optionsMenu.querySelector("[name=option-chat-slot-id]");
		chatHistoryMaxEle = optionsMenu.querySelector("[name=option-chat-history-max]");
		chatTemplateEle = optionsMenu.querySelector("[name=option-chat-template]");
		systemPromptEle = optionsMenu.querySelector("[name=option-system-prompt]");
		streamResultEle = optionsMenu.querySelector("[name=option-stream-result]");
		cachePromptsOnServerEle = optionsMenu.querySelector("[name=option-cache-prompts]");
		expectSepiaJsonEleOrObj = optionsMenu.querySelector("[name=option-expect-sepia-json]") || {};
		
		//set start values
		chatSlotIdEle.value = -1;
		chatHistoryMaxEle.value = -1;	//-1 = whatever the model/server can handle
		cachePromptsOnServerEle.checked = true;
		
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
					injectedFun.showSystemPromptEditor();
					//showPopUp("ERROR: " + (err?.message || "Failed to load system prompt."));
				}else{
					console.error("Failed to load system prompt file.", err);
					showPopUp("ERROR: " + (err?.message || "Failed to load system prompt file."));
				}
			});
		});
		
		//add templates to selector
		chatTemplates.forEach((tmpl) => {
			var opt = document.createElement("option");
			opt.textContent = tmpl.name;
			opt.value = tmpl.name;
			chatTemplateEle.appendChild(opt);
		});

		resolve();
	});
}
//chat template and active model
export function getActiveModel(){
	return chatTemplateEle.value || chatTemplates[0].name;
}
export function findBestModelMatch(modelName){
	var baseModel = modelName.match(/(tiny|olmo|dolphin|deepseek)/i) || modelName.match(/(gemma|mistral|phi|llama|qwen)/i);	//TODO: add more/fix when templates grow
	baseModel = baseModel? baseModel[0] : "";
	var fallbackTemplate = "";
	switch (baseModel) {
		case "dolphin":
			fallbackTemplate = "ChatML";
			break;
		default:
			break;
	}
	var possibleTemplateMatch = "";
	if (fallbackTemplate){
		console.log("Server model family: " + baseModel + " - template: " + fallbackTemplate);
		possibleTemplateMatch = chatTemplates.find(t => t.name.toLowerCase().indexOf(fallbackTemplate.toLowerCase()) >= 0);
	}else if (baseModel){
		console.log("Server model family: " + baseModel);
		possibleTemplateMatch = chatTemplates.find(t => t.name.toLowerCase().indexOf(baseModel.toLowerCase()) >= 0);
	}
	return possibleTemplateMatch;
}
export function getChatTemplate(name){
	if (name == undefined) name = getActiveModel();
	return chatTemplates.find(t => t.name == name);
}
export function setChatTemplate(name){
	chatTemplateEle.value = name;
}
//system prompt info and custom prompt
export function getSystemPromptInfo(name){
	if (name == undefined) name = systemPromptEle.value;
	return systemPrompts.find((sp) => sp.value == name || sp.name == name);
}
export function setSystemPromptInfo(name){
	systemPromptEle.value = name;
}
export function getCustomSystemPrompt(){
	return customSystemPrompt;
}
export function setCustomSystemPrompt(newPrompt){
	customSystemPrompt = newPrompt;
}
export function getActiveSystemPrompt(){
	return activeSystemPrompt;
}
//special formats
export function getSepiaJsonFormat(){
	return expectSepiaJsonEleOrObj.checked;
}
export function setSepiaJsonFormat(trueFalse){
	expectSepiaJsonEleOrObj.checked = trueFalse;
}

//server slots
export function setNumberOfServerSlots(totalSlots){
	if (!totalSlots){
		//disable slot ID if none or only 1 is available
		chatSlotIdEle.value = 0;
		chatSlotIdEle.max = 0;
		chatSlotIdEle.disabled = true;
		llmServerSlots = 0;
	}else{
		chatSlotIdEle.max = (totalSlots - 1);
		chatSlotIdEle.value = Math.floor(Math.random() * totalSlots);	//TODO: for now we assign a random slot
		llmServerSlots = totalSlots;
	}
	console.log("LLM server slots:", llmServerSlots);
}
export function getNumberOfServerSlots(){
	return llmServerSlots;
}
export function setActiveServerSlot(slotId){
	chatSlotIdEle.value = +slotId;
}
export function getActiveServerSlot(){
	return +chatSlotIdEle.value;
}

//history
export function getMaxChatHistory(){
	return +chatHistoryMaxEle.value;
}

//prompt cache
export function disablePromptCachingOnServer(){
	cachePromptsOnServerEle.checked = false;
	cachePromptsOnServerEle.disabled = true;
	cachePromptsOnServerEle.title += "- NOTE: Prompt cache has been disabled due to missing slot info and to avoid issues with concurrent users.";
}
export function getPromptCachingOnServer(){
	return cachePromptsOnServerEle.checked;
}

//stream result
export function getStreamResultsEnabled(){
	return streamResultEle.checked;
}

//available chat templates
const chatTemplates = [{
	name: "LLaMA_3.1_Instruct",
	llmInfo: {
		infoPrompt: "Your LLM is called LLaMA 3.1 with 8B parameters and works offline, on device, is open and may be used commercially under certain conditions. LLaMA has been trained by the company Meta, but your training data is somewhat of a mystery."
	},
	system: "<|start_header_id|>system<|end_header_id|>{{INSTRUCTION}}<|eot_id|>",
	user: "<|start_header_id|>user<|end_header_id|>{{CONTENT}}<|eot_id|>",
	assistant: "<|start_header_id|>assistant<|end_header_id|>{{CONTENT}}<|eot_id|>",
	tool: "<|start_header_id|>ipython<|end_header_id|>{{CONTENT}}<|eot_id|>",
	bosToken: "<|begin_of_text|>",
	endOfPromptToken: "<|start_header_id|>assistant<|end_header_id|>",
	stopSignals: ["<|eot_id|>"]
},{
	name: "Mistral-Instruct",
	llmInfo: {
		infoPrompt: "Your LLM is called Mistral-7B and works offline, on device, is open and may be used commercially under certain conditions. Mistral-7B has been trained by the company Mistral AI, but your training data is somewhat of a mystery."
	},
	system: "[INST] {{INSTRUCTION}} [/INST] </s>",		//NOTE: we omit the BOS token <s> here since the LLM server adds it
	user: "<s>[INST] {{CONTENT}} [/INST]",
	assistant: "{{CONTENT}}</s>",
	bosToken: "<s>",
	endOfPromptToken: "",
	stopSignals: ["</s>"]
},/*
	TODO: add config for Mistral 12B and set recommended temperature 0.3 as default
*/{
	name: "Gemma-2-it",
	llmInfo: {
		infoPrompt: "Your LLM is called Gemma 2 and works offline, on device, is open and may be used commercially under certain conditions. Gemma 2 has been trained by Google, but your training data is somewhat of a mystery."
	},
	system: "<start_of_turn>user\n{{INSTRUCTION}}\n<end_of_turn>",
	user: "<start_of_turn>user\n{{CONTENT}}<end_of_turn>",
	assistant: "<start_of_turn>model\n{{CONTENT}}<end_of_turn>",
	bosToken: "<bos>",
	endOfPromptToken: "<start_of_turn>model\n",
	stopSignals: ["<end_of_turn>"]
},{
	name: "Phi-3-instruct",
	llmInfo: {
		infoPrompt: "Your LLM is called Phi 3, works offline, on device, is open and may be used commercially under certain conditions. Phi 3 has been trained by Microsoft, but your training data is somewhat of a mystery."
	},
	system: "<|system|>\n{{INSTRUCTION}}<|end|>\n",
	user: "<|user|>\n{{CONTENT}}<|end|>\n",
	assistant: "<|assistant|>\n{{CONTENT}}<|end|>\n",
	bosToken: "<s>",
	endOfPromptToken: "<|assistant|>\n",
	stopSignals: ["</s>", "<|end|>"]
},{
	name: "DeepSeek-R1-Distilled",
	llmInfo: {
		infoPrompt: "Your LLM is called DeepSeek R1 distilled, works offline, on device, is open and may be used commercially under certain conditions. DeepSeek R1 has been trained by the company DeepSeek, but your training data is somewhat of a mystery. " 
			+ "A distilled language model is a smaller, more efficient model trained to replicate the behavior and knowledge of a larger, complex language model, enabling a somewhat similar performance with reduced computational resources."
	},
	system: "{{INSTRUCTION}}\n\n",
	user: "<｜User｜>{{CONTENT}}",
	assistant: "<｜Assistant｜>{{CONTENT}}",
	bosToken: "<｜begin▁of▁sentence｜>",
	endOfPromptToken: "<｜Assistant｜>",
	stopSignals: ["<｜end▁of▁sentence｜>"]
},{
	name: "OLMo_Instruct",
	llmInfo: {
		infoPrompt: "Your LLM is called OLMo, has 7B parameters, works offline, on device, is open and may be used commercially under certain conditions. OLMo is trained in a very transparent way by the Allen Institute for AI with open data."
	},
	system: "<|system|>\n\n{{INSTRUCTION}}<|endoftext|>",
	user: "<|user|>\n\n{{CONTENT}}<|endoftext|>",
	assistant: "<|assistant|>\n\n{{CONTENT}}<|endoftext|>",
	bosToken: "",
	endOfPromptToken: "<|assistant|>\n\n",
	stopSignals: ["</s>", "<|endoftext|>"]
},{
	name: "Qwen_2.5_Instruct",
	llmInfo: {},
	system: "<|im_start|>system\n{{INSTRUCTION}}<|im_end|>",
	user: "<|im_start|>user\n{{CONTENT}}<|im_end|>",
	assistant: "<|im_start|>assistant\n{{CONTENT}}<|im_end|>",
	bosToken: "",
	endOfPromptToken: "<|im_start|>assistant\n",
	stopSignals: ["<|im_end|>"]
},{
	name: "TinyLlama_Chat",
	llmInfo: {
		infoPrompt: "Your LLM is called TinyLlama, has 1.1B parameters, works offline, on device, is open and may be used commercially under certain conditions. More information about TinyLlama can be found on its GitHub project page."
	},
	system: "<|system|>\n\n{{INSTRUCTION}}<|endoftext|>",
	user: "<|user|>\n\n{{CONTENT}}<|endoftext|>",
	assistant: "<|assistant|>\n\n{{CONTENT}}<|endoftext|>",
	bosToken: "<s>",
	endOfPromptToken: "<|assistant|>\n\n",
	stopSignals: ["</s>", "<|endoftext|>"]
},{
	name: "Generic_ChatML",
	llmInfo: {},
	system: "<|im_start|>system\n{{INSTRUCTION}}<|im_end|>",
	user: "<|im_start|>user\n{{CONTENT}}<|im_end|>",
	assistant: "<|im_start|>assistant\n{{CONTENT}}<|im_end|>",
	bosToken: "",
	endOfPromptToken: "<|im_start|>assistant\n",
	stopSignals: ["<|im_end|>"]
},{
	name: "Generic_2",
	llmInfo: {},
	system: "<|system|>\n{{INSTRUCTION}}",
	user: "<|user|>\n{{CONTENT}}",
	assistant: "<|assistant|>\n{{CONTENT}}",
	bosToken: "",
	endOfPromptToken: "<|assistant|>\n",
	stopSignals: ["<|endoftext|>"]
}];
var chatTemplateStopSignalsAll = ["</s>", "<|end|>", "<|eot_id|>", "<|end_of_text|>", "<|im_end|>", "<|EOT|>", "<|END_OF_TURN_TOKEN|>", "<|end_of_turn|>", "<|endoftext|>", "assistant", "user"];
var knownBosTokens = ["<|begin_of_text|>", "<s>", "<bos>"];

export function getAllChatStopSignals(){
	return chatTemplateStopSignalsAll;
}
export function getKnownBosTokens(){
	return knownBosTokens;
}

//available system prompts
const systemPrompts = [{
	name: "SEPIA Chat",
	value: "sepia_chat_basic",
	promptText: "You are a voice assistant, your name is SEPIA. You have been created to answer general knowledge questions and have a nice and friendly conversation. " 
			+ "Your answers are short and precise, but can be funny sometimes. You can't access real-time data and you don't make stuff up. " 
			+ "If you write code start the code-block with '```' and the name of the programming language like '```javascript' or '```json'.",
	welcomeMessage: "SEPIA is an assistant that can have a friendly conversation, answer common knowledge questions and do a bit of coding.",
	expectSepiaJson: false
},{
	name: "SEPIA Smart Home Control",
	value: "sepia_json_sh_control",
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

//prompt loader
export function loadSystemPrompt(sysPromptName, chatTempName){
	return new Promise((resolve, reject) => {
		var selectedTemplate = getChatTemplate(chatTempName);
		var sysPromptInfo = getSystemPromptInfo(sysPromptName);
		if (!sysPromptInfo){
			reject({
				name: "FailedToLoadSystemPrompt",
				message: "Failed to load system prompt. Configuration with name '" + sysPromptName + "' is not defined."
			});
		}else if (sysPromptInfo.value == "custom"){
			if (!customSystemPrompt){
				systemPromptEle.value = systemPromptEle.options[1].value;	//TODO: reset properly
				reject({
					name: "FailedToLoadSystemPrompt",
					message: "Failed to load custom system prompt. Please define via settings."
				});
			}else{
				systemPromptEle.value = "custom";
				activeSystemPrompt = customSystemPrompt;
				setSepiaJsonFormat(false);
				resolve(activeSystemPrompt);
			}
		}else if (sysPromptInfo.file){
			var loadMsg = showPopUp("Loading system prompt file...");
			loadFile("system-prompts/" + sysPromptInfo.file, "text").then((sp) => {
				//apply text from file
				activeSystemPrompt = applySystemPromptVariables(sp, sysPromptInfo.promptVariables, selectedTemplate);
				setSepiaJsonFormat(sysPromptInfo.expectSepiaJson);
				loadMsg.popUpClose();
				resolve(activeSystemPrompt);
			}).catch((err) => {
				//failed to load file
				activeSystemPrompt = "";
				setSepiaJsonFormat(false);
				console.error("Failed to load system prompt file:", sysPromptInfo.file, err);
				loadMsg.popUpClose();
				systemPromptEle.value = systemPromptEle.options[1].value;	//TODO: reset properly
				reject({
					name: "FailedToLoadPromptFile",
					message: "Failed to load system prompt file.",
					cause: err
				});
			});
		}else if (sysPromptInfo.promptText){
			//apply text directly
			activeSystemPrompt = applySystemPromptVariables(sysPromptInfo.promptText, sysPromptInfo.promptVariables, selectedTemplate);
			setSepiaJsonFormat(sysPromptInfo.expectSepiaJson);
			resolve(activeSystemPrompt);
		}else{
			activeSystemPrompt = "";
			setSepiaJsonFormat(false);
			resolve(activeSystemPrompt);
		}
	});
}
function applySystemPromptVariables(sysPrompt, promptVariables, selectedTemplate){
	//apply system prompt variables
	if (promptVariables){
		if (!selectedTemplate || !selectedTemplate.llmInfo){
			console.error("Failed to apply system prompt variables due to missing template or 'llmInfo' property.");
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
