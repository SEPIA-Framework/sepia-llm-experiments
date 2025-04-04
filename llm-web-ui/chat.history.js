import * as llmSettings from "./llm.settings.js"

var llm = {
	settings: llmSettings
}

var chatHistory = {};	//NOTE: separate histories for each slotId
var numberOfHistoryMsgToRestoreInChat = 6;
var chatHistoryTemp = undefined;	//NOTE: this is used if we have no slot ID yet

//handlers to check and manipulate main UI (see app.js)
var chatUiHandlers;

export function setup(chatUiHandl){
	return new Promise((resolve, reject) => {
		chatUiHandlers = chatUiHandl;
		resolve();
		//TODO: here we can implement history loading from any kind of DB etc.
	});
}

//clear all
export function clearAll(keepInSessionCache){
	if (keepInSessionCache){
		var activeSlot = llm.settings.getActiveServerSlot();
		if (activeSlot != undefined && activeSlot >= 0){
			let activeHist = chatHistory[activeSlot];
			if (activeHist != undefined){
				chatHistoryTemp = chatHistory[activeSlot];
			}
		}
	}else{
		chatHistoryTemp = undefined;
	}
	chatHistory = {};
}

//add to history
export function add(slotId, role, content){
	//roles: user, assistant
	if (!chatHistory[slotId]) chatHistory[slotId] = [];
	var maxHistory = llm.settings.getMaxChatHistory();
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
export function get(slotId){
	return chatHistory[slotId]?.filter((itm) => { return itm.role != "removed" }) || [];
}
export function getActiveHistory(){
	//check if chat is closed and return either cached or slot history
	if (chatUiHandlers.isChatClosed()){
		return getCachedHistory();
	}else{
		var activeSlot = llm.settings.getActiveServerSlot();
		if (activeSlot > -1){
			return get(activeSlot);
		}else{
			return undefined;
		}
	}
}
export function update(slotId, newHist){
	chatHistory[slotId] = newHist;
}
export function restore(hist){
	if (!hist && chatHistoryTemp){
		hist = chatHistoryTemp;
		chatHistoryTemp = undefined;
	}else if (!hist){
		return;
	}
	update(llm.settings.getActiveServerSlot(), hist);
	if (numberOfHistoryMsgToRestoreInChat && hist?.length){
		chatUiHandlers.clearChatMessages();
		let totalSize = hist.length;
		let histN = hist.slice(-1 * numberOfHistoryMsgToRestoreInChat);
		let restoreSize = histN.length;
		if (restoreSize < totalSize){
			histN.unshift({
				role: "assistant",
				content: "...",
				timestamp: histN[0].timestamp
			});
		}
		chatUiHandlers.restoreChatMessages(histN);
		return {historySize: totalSize, restored: restoreSize};
	}else{
		return;
	}
}

export function cacheHistoryForRestore(hist){
	chatHistoryTemp = hist;
}
export function getCachedHistory(hist){
	return chatHistoryTemp;
}
export function clearHistoryCache(){
	chatHistoryTemp = undefined;
}