//the window that wants to communicate with the LLM UI - Typically the parent window or another iframe
var interfaceWindow;
var registeredHandler = false;
var setupDone = false;

export function setup(interfaceWin){
	//NOTE: 'interfaceWindow' should be 'window.parent' or 'iframe.contentWindow' etc.
	return new Promise((resolve, reject) => {
		if (!interfaceWin){
			reject({name: "EmbedApiError", message: "Missing window for 'postMessage' interface."});
		}else if (typeof interfaceWin.postMessage != "function"){
			reject({name: "EmbedApiError", message: "Interface window had no 'postMessage' support."});
		}else if (interfaceWin == window){
			reject({name: "EmbedApiError", message: "Interface window and origin are identical."});
		}else{
			interfaceWindow = interfaceWin;
			registerMessageHandler();
			setupDone = true;
			resolve();
		}
	});
}

export function sendReadyEvent(readyEventName){
	var data = {
		readyEventName: readyEventName
	};
	return sendPostMessagePromise(data);
}
export function sendReadyEventError(errorName){
	var data = {
		readyEventError: errorName
	};
	return sendPostMessagePromise(data);
}
export function sendUiEvent(uiEventName){
	var data = {
		uiEventName: uiEventName
	};
	return sendPostMessagePromise(data);
}

function registerMessageHandler(){
	if (!registeredHandler){
		registeredHandler = true;
		window.addEventListener("message", handlePostMessage);
	}else{
		throw {name: "EmbedApiInitError", message: "Message handler was already assigned."};
	}
}
function handlePostMessage(ev){
	if (ev.source === interfaceWindow && ev.data.interfaceName == "llm-ui-interface-msg"){
		console.error("Embedding API - UNDER CONSTRUCTION - Received message:", ev.data);	//DEBUG
	}
}

function sendPostMessage(data){
	if (!setupDone){
		throw {name: "EmbedApiInitError", message: "Please finish 'setup' before using the embed API."};
	}
	var msg = {
		interfaceName: "llm-ui-interface-msg",
		data: data
	}
	interfaceWindow.postMessage(msg, "*");
}
function sendPostMessagePromise(data){
	return new Promise((resolve, reject) => {
		try {
			sendPostMessage(data);
			resolve();
		}catch(err){
			reject(err);
		}
	});
}