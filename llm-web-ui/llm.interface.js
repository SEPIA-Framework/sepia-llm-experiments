import * as chatHistory from "./chat.history.js"
import * as llmSettings from "./llm.settings.js"

var chat = {
	history: chatHistory
}
var llm = {
	settings: llmSettings
}

var API_URL;

var chatMsgInterface;

var T_MAX_PREDICT_MS = 90000;	//max time to do text-generation, measured since the first token. 0=infinite

var serverPromptContextLength;	//prompt context configured on server

export function setup(SERVER_API_URL, chatMsgInterf){
    API_URL = SERVER_API_URL;
    chatMsgInterface = chatMsgInterf;
}

//format prompt before sending
function formatPrompt(slotId, textIn, template, sysPrompt){
	if (template == undefined) template = llm.settings.getChatTemplate();
	if (sysPrompt == undefined) sysPrompt = llm.settings.getActiveSystemPrompt();
	var formText = buildSystemPrompt(template, sysPrompt);
	formText += buildPromptHistory(slotId, template);
	//formText += template.user.replace("{{CONTENT}}", textIn);		//NOTE: we've already added this to the history
	if (template.endOfPromptToken){
		formText += template.endOfPromptToken;
	}
	return formText;
}
export function buildSystemPrompt(template, sysPrompt){
	if (template == undefined) template = llm.settings.getChatTemplate();
	if (sysPrompt == undefined) sysPrompt = llm.settings.getActiveSystemPrompt();
	return (template.system?.replace("{{INSTRUCTION}}", sysPrompt) || "");
}
export function buildPromptHistory(slotId, template){
	var hist = (slotId == undefined || slotId < 0)? chat.history.getActiveHistory() : chat.history.get(slotId);
	if (template == undefined) template = llm.settings.getChatTemplate();
	var histStr = "";
	hist?.forEach(entry => {
		var tempRole = template[entry.role];
		if (tempRole && entry.content){
			histStr += tempRole.replace("{{CONTENT}}", entry.content);
		}
	});
	return histStr;
}
//send to '/completion' endpoint
export async function chatCompletion(slotId, textIn, template){
	if (!textIn || !textIn.trim()){
		return "";		//TODO: currently 'textIn' isn't even used directy, but taken from history
	}
	var endpointUrl = API_URL + "completion";
	var doStream = llm.settings.getStreamResultsEnabled();
	var chatEle = chatMsgInterface.createNewChatAnswer();
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
			stop: template.stopSignals || llm.settings.getAllChatStopSignals(),
			//n_predict: 1024,						//NOTE: 0=just cache it, -1=infinite
			t_max_predict_ms: T_MAX_PREDICT_MS		//TODO: we stop predicting after this. Track this timer!
			/*
			temperature: 0.8,
			top_k: 40,
			top_p: 0.95,
			n_keep: 0
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
export function chatCompletionSystemPromptOnly(slotId, template, newPrompt){
	var endpointUrl = API_URL + "completion";
	var sysPrompt = (newPrompt != undefined)? newPrompt : llm.settings.getActiveSystemPrompt();
	var fullPrompt = buildSystemPrompt(template, sysPrompt);
	var estimatedTokens = estimateTokens(fullPrompt);
	var predictTime = T_MAX_PREDICT_MS;
	//if (estimatedTokens > serverPromptContextLength)		//TODO: compare to server props
	return fetch(endpointUrl, {
		method: 'POST',
		keepalive: true,		//NOTE: make sure this completes when the user closes the window
		body: JSON.stringify({
			id_slot: slotId,
			stream: false,
			prompt: fullPrompt,
			cache_prompt: true,
			stop: template.stopSignals || llm.settings.getAllChatStopSignals(),
			t_max_predict_ms: predictTime,			//TODO: we stop predicting after this. Track this timer!
			n_predict: 0,
		})
	});
}
//trigger abort controller
var abortCompletion = function(){};		//NOTE: dynamically assigned

export function abortChatCompletion(){
    abortCompletion();
}

//tokenize
export function getTokens(promptAndOrHistory){
	if (!promptAndOrHistory){
		promptAndOrHistory = formatPrompt();	//NOTE: takes all defaults as prompt
	}
	//console.error("prompt:", promptAndOrHistory);		//DEBUG
	console.log("Estimated tokens (simple split):", estimateTokens(promptAndOrHistory));		//DEBUG
	var endpointUrl = API_URL + "tokenize";
	var softFail = false;
	return callLlmServerFunction(endpointUrl, "POST", {
		content: promptAndOrHistory,
		add_special: false,
		with_pieces: false
	}, "TokenizerError", softFail);
}
function estimateTokens(input){
	return input?.split(/(?:\b|\s|\n)+/).length || 0;
}

//get data from '/props' endpoint
export function getServerProps(softFail){
	var endpointUrl = API_URL + "props";
	return callLlmServerFunction(endpointUrl, "GET", undefined, "FailedToLoadLlmServerInfo", softFail)
	.then((serverInfo) => {
		console.log("Server info:", serverInfo);
		if (serverInfo){
			serverPromptContextLength = serverInfo["n_ctx"];
		}
		return serverInfo;
	});
}
export function getServerSlots(softFail){
	var endpointUrl = API_URL + "slots";
	return callLlmServerFunction(endpointUrl, "GET", undefined, "FailedToLoadLlmServerSlots", softFail);
}
export async function getFreeServerSlot(numberOfSlots){
	if (numberOfSlots == 0) return -1;
	var freeSlotId;
	var serverSlots = await getServerSlots(true);
	if (serverSlots?.error){
		console.error("Unable to load LLM server slot info.", serverSlots.error);
		return -1;
	}else{
		//use data to find free slot
		var bosToken = llm.settings.getChatTemplate()?.bosToken || "";
		var knownBosTokens = llm.settings.getKnownBosTokens();
		for (const slot of serverSlots){
			let recentlyUsed = (slot.prompt && slot.prompt != bosToken && !knownBosTokens.includes(slot.prompt));
			let isProcessing = (slot.state == 1);
			if (!isProcessing && !recentlyUsed){
				freeSlotId = slot.id;
				break;
			}
		}
		return freeSlotId;
	}
}
export function freeServerSlot(slotId){
	//TODO: not working? we just overwrite then
	/*
	var endpointUrl = API_URL + "slots/" + encodeURIComponent(slotId) + "?action=erase";
	return callLlmServerFunction(endpointUrl, "POST", undefined, "FailedToLoadLlmServerSlots", true);
	*/
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
				//console.log("processing lines:", lines.length);			//DEBUG
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
		//TODO: improve whole JSON parsing etc.
		if (expectSepiaJson){
			//try to clean up in advance (Gemma-2 2B has some issues here for example)
			ans = ans.replace(/^(```json)/, "").replace(/^[\n]/, "");
			ans = ans.replace(/(```)$/, "").replace(/[\n]$/, "");
		}
		if (ans.startsWith('{"') && ans.endsWith('}')){
			try {
				//TODO: this can fail for example if quotes where used inside the JSON message (not escaped \") or if it wasn't meant to be JSON at all
				ansJson = JSON.parse(ans);
				chat.history.add(slotId, "assistant", JSON.stringify(ansJson));
			}catch(err){
				if (expectSepiaJson){
					console.error("Failed to handle answer while trying to parse:", ans);		//DEBUG
					ansJson = {"error": "Failed to handle answer while trying to parse JSON"};
				}else{
					chat.history.add(slotId, "assistant", ans);
				}
			}
		}else{
			ansJson = {command: "chat", message: ans};	//NOTE: this will recover text if SEPIA JSON was expected but LLM decided to ignore it
			if (expectSepiaJson){
				chat.history.add(slotId, "assistant", JSON.stringify(ansJson));
			}else{
				chat.history.add(slotId, "assistant", ans);
			}
		}
		if (ansJson?.command){
			if (ansJson.command == "chat"){
				chatEle.addText(ansJson.message);
			}else{
				//TODO: check ansJson.error and skip or break
				chatEle.addCommand(ansJson);
			}
		}else{
			chatEle.addText(ans);
		}
	});
}