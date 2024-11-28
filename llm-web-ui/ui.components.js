import * as chatHistory from "./chat.history.js"
import * as llmSettings from "./llm.settings.js"
import * as llmInterface from "./llm.interface.js"

var chat = {
	history: chatHistory
}
var llm = {
	settings: llmSettings,
	interface: llmInterface
}

//handlers to check and manipulate main UI
var chatUiHandlers;

export function setup(chatUiHandl){
	chatUiHandlers = chatUiHandl;
}

export function showSystemPromptEditor(){
	var content = buildSystemPromptEditComponent("50vh");
	var sysPromptInfo = llm.settings.getSystemPromptInfo();
	var customSystemPrompt = llm.settings.getCustomSystemPrompt();
	if ((!sysPromptInfo || sysPromptInfo.value == "custom") && customSystemPrompt){
		content.setSystemPrompt(customSystemPrompt);
	}
	var buttons = [{
		name: "Save",
		fun: function(){
			llm.settings.setSystemPromptInfo("custom");
			llm.settings.setCustomSystemPrompt(content.getSystemPrompt());
			llm.settings.loadSystemPrompt().catch((err) => {
				console.error("Failed to load system prompt.", err);
				showPopUp("ERROR: " + (err?.message || "Failed to load system prompt."));
			});
		},
		closeAfterClick: true
	},{
		name: "Import",
		fun: function(){
			openTextFilePrompt(function(txt){
				importText(txt);
			}, function(err){
				console.error("Failed to load file:", err);		//DEBUG
				showPopUp("Failed to load file.");
			});
		}
	}];
	if (chat.history.getActiveHistory()){
		buttons.push({
			name: "Edit history",
			fun: function(){
				showChatHistoryEditor();
			},
			closeAfterClick: true
		});
	}
	buttons.push({
		name: "Count tokens",
		fun: function(){
			countTokensAndShowResult();
		},
		closeAfterClick: false
	});
	buttons.push({
		name: "Close",
		closeAfterClick: true
	});
	addDragAndDropFileImport(content, function(txt){
		importText(txt);
	}, function(err){
		console.error("Failed to load file:", err);		//DEBUG
		showPopUp("Failed to load file.");
	},{
		fileType: "text/plain"
	});
	var pop = showPopUp(content, buttons, {
		width: "800px"
	});
	var importText = function(txt){
		try {
			var txtJson = JSON.parse(txt);
			restoreSystemPromptAndHistory(txtJson).then(() => {
				pop.popUpClose();
				showSystemPromptEditor();
			}).catch((err) => {
				console.error("Failed to load file:", err);		//DEBUG
				showPopUp("Failed to load file. JSON data seems to be corrupted.");
			});
		}catch (err){
			console.error("Failed to load file. Could not parse JSON data:", err);		//DEBUG
			showPopUp("Failed to load file. Could not parse JSON data.");
		}
	}
}

export function showChatHistoryEditor(){
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
				importText(txt);
			}, function(err){
				console.error("Failed to load file:", err);		//DEBUG
				showPopUp("Failed to load file.");
			});
		},
		closeAfterClick: false
	},{
		name: "Count tokens",
		fun: function(){
			countTokensAndShowResult();
		},
		closeAfterClick: false
	},{
		name: "Clear all",
		fun: function(){
			chat.history.update(llm.settings.getActiveServerSlot(), []);
			chatUiHandlers.clearChatMessages();
			pop.popUpClose();
			showChatHistoryEditor();
		},
		closeAfterClick: false
	},{
		name: "Close",
		closeAfterClick: true
	}];
	addDragAndDropFileImport(content, function(txt){
		importText(txt);
	}, function(err){
		console.error("Failed to load file:", err);		//DEBUG
		showPopUp("Failed to load file.");
	},{
		fileType: "text/plain"
	});
	var pop = showPopUp(content, buttons, {
		width: "800px"
	});
	var importText = function(txt){
		try {
			var txtJson = JSON.parse(txt);
			restoreSystemPromptAndHistory(txtJson).then(() => {
				pop.popUpClose();
				showChatHistoryEditor();
			}).catch((err) => {
				console.error("Failed to load file:", err);		//DEBUG
				showPopUp("Failed to load file. JSON data seems to be corrupted.");
			});
		}catch (err){
			console.error("Failed to load file. Could not parse JSON data:", err);		//DEBUG
			showPopUp("Failed to load file. Could not parse JSON data.");
		}
	}
}
function buildSystemPromptEditComponent(txtareaHeight){
	var content = document.createElement("div");
	content.className = "section-wrapper";
	var info = document.createElement("p");
	info.textContent = "Here you can add/edit your system prompt:";
	var textC = document.createElement("div");
	textC.className = "text-container";
	var txt = document.createElement("textarea");
	if (txtareaHeight){
		txt.style.height = (typeof txtareaHeight == "number")? (txtareaHeight + "px") : txtareaHeight;
	}
	var sysPromptInfo = llm.settings.getSystemPromptInfo();
	if (!sysPromptInfo || sysPromptInfo.value == "custom"){
		txt.placeholder = ("Enter your prompt here.");
	}else{
		txt.placeholder = ("Currently selected preset:\n" + sysPromptInfo.name);
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
	var slotHistory = chat.history.getActiveHistory();
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
		var entryIndex = (i+1);
		role.textContent = entryIndex + ". " + entry.role;
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
				intro: "Edit history at index " + entryIndex + ":",
				placeholder: "Your chat history",
				width: "800px"
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

function countTokensAndShowResult(){
	llm.interface.getTokens().then((res) => {
		if (res?.tokens){
			showPopUp("Total tokens (system prompt + chat history): " + res.tokens.length, 
				undefined, {width: "480px"});
		}else{
			showPopUp("Failed to count tokens, sorry. Tokenizer returned invalid data.");
		}
	}).catch((err) => {
		console.error("Failed to count tokens:", err);		//DEBUG
		showPopUp("Failed to count tokens, sorry. Please check server connection.");
	});
}

function exportSystemPromptAndHistory(){
	var sysPromptInfo = llm.settings.getSystemPromptInfo();
	return {
		systemPromptSelected: sysPromptInfo.value,
		systemPrompt: ((sysPromptInfo.value == "custom")? llm.settings.getCustomSystemPrompt() : ""),
		history: chat.history.getActiveHistory()
	}
}
function restoreSystemPromptAndHistory(data){
	llm.settings.setSystemPromptInfo(data.systemPromptSelected);
	llm.settings.setCustomSystemPrompt(data.systemPrompt);
	if (chatUiHandlers.isChatClosed()){
		chat.history.cacheHistoryForRestore(data.history);
	}else{
		chat.history.restore(data.history);
	}
	llm.settings.setSystemPromptInfo(data.systemPromptSelected);
	return llm.settings.loadSystemPrompt(data.systemPromptSelected);
}