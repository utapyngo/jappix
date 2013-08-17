/*

Jappix - An open social platform
These are the presence JS scripts for Jappix

-------------------------------------------------

License: AGPL
Author: Valérian Saliou
Last revision: 21/06/12

*/

// Sends the user first presence
var FIRST_PRESENCE_SENT = false;

function firstPresence(checksum) {
	logThis('First presence sent.', 3);
	
	// Jappix is now ready: change the title
	pageTitle('talk');
	
	// Anonymous check
	var is_anonymous = isAnonymous();
	
	// Update our marker
	FIRST_PRESENCE_SENT = true;
	
	// Try to use the last status message
	var status = getDB('options', 'presence-status');
	
	if(!status)
		status = '';
	
	// We tell the world that we are online
	if(!is_anonymous)
		sendPresence('', '', '', status, checksum);
	
	// Any status to apply?
	if(status)
		$('#presence-status').val(status);
	
	// Enable the presence picker
	$('#presence-status').removeAttr('disabled');
	$('#my-infos .f-presence a.picker').removeClass('disabled');
	
	// We set the last activity stamp
	PRESENCE_LAST_ACTIVITY = getTimeStamp();
	
	// We store our presence
	setDB('presence-show', 1, 'available');
	
	// Not anonymous
	if(!is_anonymous) {
		// We get the stored bookmarks (because of the photo hash and some other stuffs, we must get it later)
		getStorage(NS_BOOKMARKS);
		
		// We open a new chat if a XMPP link was submitted
		if((parent.location.hash != '#OK') && LINK_VARS['x']) {
			// A link is submitted in the URL
			xmppLink(LINK_VARS['x']);
			
			// Set a OK status
			parent.location.hash = 'OK';
		}
	}
}

// Handles incoming presence packets
function handlePresence(presence) {
	// We define everything needed here
	var from = fullXID(getStanzaFrom(presence));
	var hash = hex_md5(from);
	var node = presence.getNode();
	var xid = bareXID(from);
	var xidHash = hex_md5(xid);
	var resource = thisResource(from);
	
	// We get the type content
	var type = presence.getType();
	if(!type)
		type = '';
	
	// We get the priority content
	var priority = presence.getPriority() + '';
	if(!priority || (type == 'error'))
		priority = '0';
	
	// We get the show content
	var show = presence.getShow();
	if(!show || (type == 'error'))
		show = '';
	
	// We get the status content
	var status = presence.getStatus();
	if(!status || (type == 'error'))
		status = '';
	
	// We get the photo content
	var photo = $(node).find('x[xmlns="' + NS_VCARD_P + '"]:first photo');
	var checksum = photo.text();
	var hasPhoto = photo.size();
	
	if(hasPhoto && (type != 'error'))
		hasPhoto = 'true';
	else
		hasPhoto = 'false';
	
	// We get the CAPS content
	var caps = $(node).find('c[xmlns="' + NS_CAPS + '"]:first').attr('ver');
	if(!caps || (type == 'error'))
		caps = '';
	
	// This presence comes from another resource of my account with a difference avatar checksum
	if((xid == getXID()) && (hasPhoto == 'true') && (checksum != getDB('checksum', 1)))
		getAvatar(getXID(), 'force', 'true', 'forget');
	
	// This presence comes from a groupchat
	if(isPrivate(xid)) {
		var x_muc = $(node).find('x[xmlns="' + NS_MUC_USER + '"]:first');
		var item = x_muc.find('item');
		var affiliation = item.attr('affiliation');
		var role = item.attr('role');
		var reason = item.find('reason').text();
		var iXID = item.attr('jid');
		var iNick = item.attr('nick');
		var nick = resource;
		var messageTime = getCompleteTime();
		var notInitial = true;
		var resources_obj;

		// Read the status code
		var status_code = new Array();
		
		x_muc.find('status').each(function() {
			status_code.push(parseInt($(this).attr('code')));
		});
		
		// If this is an initial presence (when user join the room)
		if(exists('#' + xidHash + '[data-initial="true"]'))
			notInitial = false;
		
		// If one user is quitting
		if(type && (type == 'unavailable')) {
			displayMucPresence(from, xidHash, hash, type, show, status, affiliation, role, reason, status_code, iXID, iNick, messageTime, nick, notInitial);
			
			removeDB('presence-stanza', from);
			resources_obj = removeResourcePresence(xid, resource);
		}
		
		// If one user is joining
		else {
			// Fixes M-Link first presence bug (missing ID!)
			if((nick == getMUCNick(xidHash)) && (presence.getID() == null) && !exists('#page-engine #' + xidHash + ' .list .' + hash)) {
				handleMUC(presence);
				
				logThis('Passed M-Link MUC first presence handling.', 2);
			}
			
			else {
				displayMucPresence(from, xidHash, hash, type, show, status, affiliation, role, reason, status_code, iXID, iNick, messageTime, nick, notInitial);
				
				var xml = '<presence from="' + encodeQuotes(from) + '"><priority>' + priority.htmlEnc() + '</priority><show>' + show.htmlEnc() + '</show><type>' + type.htmlEnc() + '</type><status>' + status.htmlEnc() + '</status><avatar>' + hasPhoto.htmlEnc() + '</avatar><checksum>' + checksum.htmlEnc() + '</checksum><caps>' + caps.htmlEnc() + '</caps></presence>';

				setDB('presence-stanza', from, xml);
				resources_obj = addResourcePresence(xid, resource);
			}
		}
		
		// Manage the presence
		processPriority(from, resource, resources_obj);
		presenceFunnel(from, hash);
	}
	
	// This presence comes from an user or a gateway
	else {
		// Subscribed/Unsubscribed stanzas
		if((type == 'subscribed') || (type == 'unsubscribed'))
			return;
		// Subscribe stanza
		else if(type == 'subscribe') {
			// This is a buddy we can safely authorize, because we added him to our roster
			if(exists('#buddy-list .buddy[data-xid="' + escape(xid) + '"]'))
				acceptSubscribe(xid);
			
			// We do not know this entity, we'd be better ask the user
			else {
				// Get the nickname
				var nickname = $(node).find('nick[xmlns="' + NS_NICK + '"]:first').text();
				
				// New notification
				newNotification('subscribe', xid, [xid, nickname], status);
			}
		}
		
		// Unsubscribe stanza
		else if(type == 'unsubscribe')
			sendRoster(xid, 'remove');
		
		// Other stanzas
		else {
			var resources_obj;

			// Unavailable/error presence
			if(type == 'unavailable') {
				removeDB('presence-stanza', from);
				resources_obj = removeResourcePresence(xid, resource);
			}
			
			// Other presence (available, subscribe...)
			else {
				var xml = '<presence from="' + encodeQuotes(from) + '"><priority>' + priority.htmlEnc() + '</priority><show>' + show.htmlEnc() + '</show><type>' + type.htmlEnc() + '</type><status>' + status.htmlEnc() + '</status><avatar>' + hasPhoto.htmlEnc() + '</avatar><checksum>' + checksum.htmlEnc() + '</checksum><caps>' + caps.htmlEnc() + '</caps></presence>';

				setDB('presence-stanza', from, xml);
				resources_obj = addResourcePresence(xid, resource);
			}

			// We manage the presence
			processPriority(xid, resource, resources_obj);
			presenceFunnel(xid, xidHash);
			
			// We display the presence in the current chat
			if(exists('#' + xidHash)) {
				var dStatus = filterStatus(xid, status, false);
				
				if(dStatus)
					dStatus = ' (' + dStatus + ')';
				
				// Generate the presence-in-chat code
				var dName = getBuddyName(from).htmlEnc();
				var dBody = dName + ' (' + from + ') ' + _e("is now") + ' ' + humanShow(show, type) + dStatus;
				
				// Check whether it has been previously displayed
				var can_display = true;
				
				if($('#' + xidHash + ' .one-line.system-message:last').html() == dBody)
					can_display = false;
				
				if(can_display)
					displayMessage('chat', xid, xidHash, dName, dBody, getCompleteTime(), getTimeStamp(), 'system-message', false);
			}
		}
	}
	
	// For logger
	if(!show) {
		if(!type)
			show = 'available';
		else
			show = 'unavailable';
	}
	
	logThis('Presence received: ' + show + ', from ' + from);
}

// Displays a MUC presence
function displayMucPresence(from, roomHash, hash, type, show, status, affiliation, role, reason, status_code, iXID, iNick, messageTime, nick, initial) {
	// Generate the values
	var thisUser = '#page-engine #' + roomHash + ' .list .' + hash;
	var thisPrivate = $('#' + hash + ' .message-area');
	var nick_html = nick.htmlEnc();
	var real_xid = '';
	var write = nick_html + ' ';
	var notify = false;
	
	// Reset data?
	if(!role)
		role = 'participant';
	if(!affiliation)
		affiliation = 'none';
	
	// Must update the role?
	if(exists(thisUser) && (($(thisUser).attr('data-role') != role) || ($(thisUser).attr('data-affiliation') != affiliation)))
		$(thisUser).remove();
	
	// Any XID submitted?
	if(iXID) {
		real_xid = ' data-realxid="' + iXID + '"';
		iXID = bareXID(iXID);
		write += ' (<a onclick="return checkChatCreate(\'' + encodeOnclick(iXID) + '\', \'chat\');" href="xmpp:' + encodeOnclick(iXID) + '">' + iXID + '</a>) ';
	}
	
	// User does not exists yet
	if(!exists(thisUser) && (!type || (type == 'available'))) {
		var myself = '';
		
		// Is it me?
		if(nick == getMUCNick(roomHash)) {
			// Enable the room
			$('#' + roomHash + ' .message-area').removeAttr('disabled');
			
			// Marker
			myself = ' myself';
		}
		
		// Set the user in the MUC list
		$('#' + roomHash + ' .list .' + role + ' .title').after(
			'<div class="user ' + hash + myself + '" data-xid="' + encodeQuotes(from) + '" data-nick="' + escape(nick) + '"' + real_xid + ' data-role="' + encodeQuotes(role) + '" data-affiliation="' + encodeQuotes(affiliation) + '">' + 
				'<div class="name talk-images available">' + nick_html + '</div>' + 
				
				'<div class="avatar-container">' + 
					'<img class="avatar" src="' + './img/others/default-avatar.png' + '" alt="" />' + 
				'</div>' + 
			'</div>'
		);
		
		// Click event
		if(nick != getMUCNick(roomHash))
			$(thisUser).on('click', function() {
				checkChatCreate(from, 'private');
			});
		
		// We tell the user that someone entered the room
		if(!initial) {
			notify = true;
			write += _e("joined the chat room");
			
			// Any status?
			if(status)
				write += ' (' + filterThisMessage(status, nick_html, true) + ')';
			else
				write += ' (' + _e("no status") + ')';
		}
		
		// Enable the private chat input
		thisPrivate.removeAttr('disabled');
	}
	
	else if((type == 'unavailable') || (type == 'error')) {
		// Is it me?
		if(nick == getMUCNick(roomHash)) {
			$(thisUser).remove();
			
			// Disable the groupchat input
			$('#' + roomHash + ' .message-area').attr('disabled', true);
			
			// Remove all the groupchat users
			$('#' + roomHash + ' .list .user').remove();
		}
		
		// Someone has been kicked or banned?
		if(existArrayValue(status_code, 301) || existArrayValue(status_code, 307)) {
			$(thisUser).remove();
			notify = true;
			
			// Kicked?
			if(existArrayValue(status_code, 307))
				write += _e("has been kicked");
			
			// Banned?
			if(existArrayValue(status_code, 301))
				write += _e("has been banned");
			
			// Any reason?
			if(reason)
				write += ' (' + filterThisMessage(reason, nick_html, true) + ')';
			else
				write += ' (' + _e("no reason") + ')';
		}
		
		// Nickname change?
		else if(existArrayValue(status_code, 303) && iNick) {
			notify = true;
			write += printf(_e("changed his/her nickname to %s"), iNick.htmlEnc());
			
			// New values
			var new_xid = cutResource(from) + '/' + iNick;
			var new_hash = hex_md5(new_xid);
			var new_class = 'user ' + new_hash;
			
			if($(thisUser).hasClass('myself'))
				new_class += ' myself';
			
			// Die the click event
			$(thisUser).off('click');
			
			// Change to the new nickname
			$(thisUser).attr('data-nick', escape(iNick))
			           .attr('data-xid', new_xid)
			           .find('.name').text(iNick);
			
			// Change the user class
			$(thisUser).attr('class', new_class);
			
			// New click event
			$('#page-engine #' + roomHash + ' .list .' + new_hash).on('click', function() {
				checkChatCreate(new_xid, 'private');
			});
		}
		
		// We tell the user that someone left the room
		else if(!initial) {
			$(thisUser).remove();
			notify = true;
			write += _e("left the chat room");
			
			// Any status?
			if(status)
				write += ' (' + filterThisMessage(status, nick_html, true) + ')';
			else
				write += ' (' + _e("no status") + ')';
		}
		
		// Disable the private chat input
		thisPrivate.attr('disabled', true);
	}
	
	// Must notify something
	if(notify)
		displayMessage('groupchat', from, roomHash, nick_html, write, messageTime, getTimeStamp(), 'system-message', false);
	
	// Set the good status show icon
	switch(show) {
		case 'chat':
		case 'away':
		case 'xa':
		case 'dnd':
			break;
		
		default:
			show = 'available';
			break;
	}
	
	$(thisUser + ' .name').attr('class', 'name talk-images ' + show);
	
	// Set the good status text
	var uTitle = nick;
	
	// Any XID to add?
	if(iXID)
		uTitle += ' (' + iXID + ')';
	
	// Any status to add?
	if(status)
		uTitle += ' - ' + status;
	
	$(thisUser).attr('title', uTitle);
	
	// Show or hide the role category, depending of its content
	$('#' + roomHash + ' .list .role').each(function() {
		if($(this).find('.user').size())
			$(this).show();
		else
			$(this).hide();
	});
}

// Filters a given status
function filterStatus(xid, status, cut) {
	var dStatus = '';
	
	if(!status)
		status = '';
	
	else {
		if(cut)
			dStatus = truncate(status, 50);
		else
			dStatus = status;
		
		dStatus = filterThisMessage(dStatus, getBuddyName(xid).htmlEnc(), true);
	}
	
	return dStatus;
}

// Displays a user's presence
function displayPresence(value, type, show, status, hash, xid, avatar, checksum, caps) {
	// Display the presence in the roster
	var path = '#buddy-list .' + hash;
	var buddy = $('#buddy-list .content .' + hash);
	var dStatus = filterStatus(xid, status, false);
	var tStatus = encodeQuotes(status);
	var biStatus;
	
	// The buddy presence behind his name
	$(path + ' .name .buddy-presence').replaceWith('<p class="buddy-presence talk-images ' + type + '">' + value + '</p>');
	
	// The buddy presence in the buddy infos
	if(dStatus)
		biStatus = dStatus;
	else
		biStatus = value;
	
	$(path + ' .bi-status').replaceWith('<p class="bi-status talk-images ' + type + '" title="' + tStatus + '">' + biStatus + '</p>');
	
	// When the buddy disconnect himself, we hide him
	if((type == 'unavailable') || (type == 'error')) {
		// Set a special class to the buddy
		buddy.addClass('hidden-buddy');
		
		// No filtering is launched?
		if(!SEARCH_FILTERED)
			buddy.hide();
		
		// All the buddies are shown?
		if(BLIST_ALL)
			buddy.show();
		
		// Chat stuffs
		if(exists('#' + hash)) {
			// Remove the chatstate stuffs
			resetChatState(hash);
			$('#' + hash + ' .chatstate').remove();
			$('#' + hash + ' .message-area').removeAttr('data-chatstates');
			
			// Get the buddy avatar (only if a chat is opened)
			getAvatar(xid, 'cache', 'true', 'forget');
		}
	}
	
	// If the buddy is online
	else {
		// When the buddy is online, we show it
		buddy.removeClass('hidden-buddy');
		
		// No filtering is launched?
		if(!SEARCH_FILTERED)
			buddy.show();
		
		// Get the online buddy avatar if not a gateway
		getAvatar(xid, 'cache', avatar, checksum);
	}
	
	// Display the presence in the chat
	if(exists('#' + hash)) {
		// We generate a well formed status message
		if(dStatus) {
			// No need to write the same status two times
			if(dStatus == value)
				dStatus = '';
			else
				dStatus = ' (' + dStatus + ')';
		}
		
		// We show the presence value
		$('#' + hash + ' .bc-infos').replaceWith('<p class="bc-infos" title="' + tStatus + '"><span class="' + type + ' show talk-images">' + value + '</span>' + dStatus + '</p>');
		
		// Process the new status position
		adaptChatPresence(hash);
		
		// Get the disco#infos for this user
		var highest = highestPriority(xid);
		
		if(highest)
			getDiscoInfos(highest, caps);
		else
			displayDiscoInfos(xid, '');
	}
	
	// Display the presence in the switcher
	if(exists('#page-switch .' + hash))
		$('#page-switch .' + hash + ' .icon').removeClass('available unavailable error away busy').addClass(type);
	
	// Update roster groups
	if(!SEARCH_FILTERED)
		updateGroups();
	else
		funnelFilterBuddySearch();
}

// Process the chat presence position
function adaptChatPresence(hash) {
	// Get values
	var pep_numb = $('#' + hash + ' .bc-pep').find('a').size();
	
	// Process the left/right position
	var presence_h = 12;
	
	if(pep_numb)
		presence_h = (pep_numb * 20) + 18;
	
	// Apply the left/right position
	var presence_h_tag = ($('html').attr('dir') == 'rtl') ? 'left' : 'right';
	$('#' + hash + ' p.bc-infos').css(presence_h_tag, presence_h);
}

// Convert the presence "show" element into a human-readable output
function humanShow(show, type) {
	if(type == 'unavailable')
		show = _e("Unavailable");
	
	else if(type == 'error')
		show = _e("Error");
	
	else {
		switch(show) {
			case 'chat':
				show = _e("Talkative");
				break;
			
			case 'away':
				show = _e("Away");
				break;
			
			case 'xa':
				show = _e("Not available");
				break;
			
			case 'dnd':
				show = _e("Busy");
				break;
			
			default:
				show = _e("Available");
				break;
		}
	}
	
	return show;
}

// Makes the presence data go in the right way
function presenceIA(type, show, status, hash, xid, avatar, checksum, caps) {
	// Is there a status defined?
	if(!status)
		status = humanShow(show, type);
	
	// Then we can handle the events
	if(type == 'error')
		displayPresence(_e("Error"), 'error', show, status, hash, xid, avatar, checksum, caps);
	
	else if(type == 'unavailable')
		displayPresence(_e("Unavailable"), 'unavailable', show, status, hash, xid, avatar, checksum, caps);
	
	else {
		switch(show) {
			case 'chat':
				displayPresence(_e("Talkative"), 'available', show, status, hash, xid, avatar, checksum, caps);
				break;
			
			case 'away':
				displayPresence(_e("Away"), 'away', show, status, hash, xid, avatar, checksum, caps);
				break;
			
			case 'xa':
				displayPresence(_e("Not available"), 'busy', show, status, hash, xid, avatar, checksum, caps);
				break;
			
			case 'dnd':
				displayPresence(_e("Busy"), 'busy', show, status, hash, xid, avatar, checksum, caps);
				break;
			
			default:
				displayPresence(_e("Available"), 'available', show, status, hash, xid, avatar, checksum, caps);
				break;
		}
	}
}

// Flush the presence data for a given user
function flushPresence(xid) {
	var flushed_marker = false;

	for(var i = 0; i < storageDB.length; i++) {
		// Get the pointer values
		var current = storageDB.key(i);
		
		// If the pointer is on a stored presence
		if(explodeThis('_', current, 0) == 'presence') {
			// Get the current XID
			var now_full = explodeThis('_', current, 1);
			var now_bare = bareXID(now_full);
			
			// If the current XID equals the asked XID
			if(now_bare == xid) {
				if(removeDB('presence-stanza', now_full)) {
					logThis('Presence data flushed for: ' + now_full, 3);

					flushed_marker = true;
					i--;
				}
			}
		}
	}

	return flushed_marker;
}

// Process the highest resource priority for an user
function processPriority(xid, resource, resources_obj) {
	try {
		if(!xid) {
			logThis('processPriority > No XID value', 2);
			return;
		}

		// Initialize vars
		var cur_resource, cur_from, cur_pr,
		    cur_xml, cur_priority,
		    from_highest, from_highest;

		from_highest = null;
		max_priority = null;

		// Groupchat presence? (no priority here)
		if(xid.indexOf('/') !== -1) {
			from_highest = xid;

			logThis('Processed presence for groupchat user: ' + xid);
		} else {
			if(!highestPriority(xid)) {
				from_highest = xid + '/' + resource;

				logThis('Processed initial presence for regular user: ' + xid + ' (highest priority for: ' + (from_highest || 'none') + ')');
			} else {
				for(cur_resource in resources_obj) {
					// Read presence data
					cur_from = xid + '/' + cur_resource;
					cur_pr   = getDB('presence-stanza', cur_from);

					if(cur_pr) {
						// Parse presence data
						cur_xml      = XMLFromString(cur_pr);
						cur_priority = $(cur_xml).find('priority').text();
						cur_priority = !isNaN(cur_priority) ? parseInt(cur_priority) : 0;
						
						// Higher priority?
						if((cur_priority >= max_priority) || (max_priority == null)) {
							max_priority = cur_priority;
							from_highest = cur_from;
						}
					}
				}

				logThis('Processed presence for regular user: ' + xid + ' (highest priority for: ' + (from_highest || 'none') + ')');
			}
		}

		if(from_highest)
			setDB('presence-priority', xid, from_highest);
		else
			removeDB('presence-priority', xid);
	} catch(e) {
		logThis('Error on presence processing: ' + e, 1);
	}
}

// Returns the highest presence priority XID for an user
function highestPriority(xid) {
	return getDB('presence-priority', xid) || '';
}

// Gets the resource from a XID which has the highest priority
function highestPriorityStanza(xid) {
	var pr;
	var highest = highestPriority(xid);

	if(highest)  pr = getDB('presence-stanza', highest);
	if(!pr)      pr = '<presence><type>unavailable</type></presence>';

	return XMLFromString(pr);
}

// Lists presence resources for an user
function resourcesPresence(xid) {
	try {
		var resources_obj = {};
		var resources_db  = getDB('presence-resources', xid);

		if(resources_db) {
			resources_obj = $.evalJSON(resources_db);
		}

		return resources_obj;
	} catch(e) {}
}

// Adds a given presence resource for an user
function addResourcePresence(xid, resource) {
	try {
		var resources_obj = resourcesPresence(xid);

		resources_obj[resource] = 1;
		setDB('presence-resources', xid, $.toJSON(resources_obj));

		return resources_obj;
	} catch(e) {}

	return null;
}

// Removes a given presence resource for an user
function removeResourcePresence(xid, resource) {
	try {
		var resources_obj = resourcesPresence(xid);

		delete resources_obj[resource];
		setDB('presence-resources', xid, $.toJSON(resources_obj));

		return resources_obj;
	} catch(e) {}

	return null;
}

// Makes something easy to process for the presence IA
function presenceFunnel(xid, hash) {
	// Get the highest priority presence value
	var xml = $(highestPriorityStanza(xid));
	var type = xml.find('type').text();
	var show = xml.find('show').text();
	var status = xml.find('status').text();
	var avatar = xml.find('avatar').text();
	var checksum = xml.find('checksum').text();
	var caps = xml.find('caps').text();

	// Display the presence with that stored value
	if(!type && !show)
		presenceIA('', 'available', status, hash, xid, avatar, checksum, caps);
	else
		presenceIA(type, show, status, hash, xid, avatar, checksum, caps);
}

// Sends a defined presence packet
function sendPresence(to, type, show, status, checksum, limit_history, password, handle) {
	// Get some stuffs
	var priority = getDB('priority', 1);
	
	if(!priority)
		priority = '1';
	if(!checksum)
		checksum = getDB('checksum', 1);
	if(show == 'available')
		show = '';
	if(type == 'available')
		type = '';
	
	// New presence
	var presence = new JSJaCPresence();
	
	// Avoid "null" or "none" if nothing stored
	if(!checksum || (checksum == 'none'))
		checksum = '';
	
	// Presence headers
	if(to)
		presence.setTo(to);
	if(type)
		presence.setType(type);
	if(show)
		presence.setShow(show);
	if(status)
		presence.setStatus(status);
	
	presence.setPriority(priority);
	
	// CAPS (entity capabilities)
	presence.appendNode('c', {'xmlns': NS_CAPS, 'hash': 'sha-1', 'node': 'http://jappix.org/', 'ver': myCaps()});
	
	// Nickname
	var nickname = getName();
	
	if(nickname && !limit_history)
		presence.appendNode('nick', {'xmlns': NS_NICK}, nickname);
	
	// vcard-temp:x:update node
	var x = presence.appendNode('x', {'xmlns': NS_VCARD_P});
	x.appendChild(presence.buildNode('photo', {'xmlns': NS_VCARD_P}, checksum));
	
	// MUC X data
	if(limit_history || password) {
		var xMUC = presence.appendNode('x', {'xmlns': NS_MUC});
		
		// Max messages age (for MUC)
		if(limit_history)
			xMUC.appendChild(presence.buildNode('history', {'maxstanzas': 20, 'seconds': 86400, 'xmlns': NS_MUC}));
		
		// Room password
		if(password)
			xMUC.appendChild(presence.buildNode('password', {'xmlns': NS_MUC}, password));
	}
	
	// If away, send a last activity time
	if((show == 'away') || (show == 'xa')) {
		/* REF: http://xmpp.org/extensions/xep-0256.html */
		
		presence.appendNode(presence.buildNode('query', {
			'xmlns': NS_LAST,
			'seconds': getPresenceLast()
		}));
	}
	
	// Else, set a new last activity stamp
	else
		PRESENCE_LAST_ACTIVITY = getTimeStamp();
	
	// Send the presence packet
	if(handle)
		con.send(presence, handle);
	else
		con.send(presence);
	
	if(!type)
		type = 'available';
	
	logThis('Presence sent: ' + type, 3);
}

// Performs all the actions to get the presence data
function presenceSend(checksum, autoidle) {
	// We get the values of the inputs
	var show = getUserShow();
	var status = getUserStatus();
	
	// Send the presence
	if(!isAnonymous())
		sendPresence('', '', show, status, checksum);
	
	// We set the good icon
	presenceIcon(show);
	
	// We store our presence
	if(!autoidle)
		setDB('presence-show', 1, show);
	
	// We send the presence to our active MUC
	$('.page-engine-chan[data-type="groupchat"]').each(function() {
		var tmp_nick = $(this).attr('data-nick');
		
		if(!tmp_nick)
			return;
		
		var room = unescape($(this).attr('data-xid'));
		var nick = unescape(tmp_nick);
		
		// Must re-initialize?
		if(RESUME)
			getMUC(room, nick);
		
		// Not disabled?
		else if(!$(this).find('.message-area').attr('disabled'))
			sendPresence(room + '/' + nick, '', show, status, '', true);
	});
}

// Changes the presence icon
function presenceIcon(value) {
	$('#my-infos .f-presence a.picker').attr('data-value', value);
}

// Sends a subscribe stanza
function sendSubscribe(to, type) {
	var status = '';
	
	// Subscribe request?
	if(type == 'subscribe')
		status = printf(_e("Hi, I am %s, I would like to add you as my friend."), getName());
	
	sendPresence(to, type, '', status);
}

// Accepts the subscription from another entity
function acceptSubscribe(xid, name) {
	// We update our chat
	$('#' + hex_md5(xid) + ' .tools-add').hide();
	
	// We send a subsribed presence (to confirm)
	sendSubscribe(xid, 'subscribed');
	
	// We send a subscription request (subscribe both sides)
	sendSubscribe(xid, 'subscribe');
	
	// Specify the buddy name (if any)
	if(name)
		sendRoster(xid, '', name)
}

// Sends automatic away presence
var AUTO_IDLE = false;

function autoIdle() {
	// Not connected?
	if(!isConnected())
		return;
	
	// Stop if an xa presence was set manually
	var last_presence = getUserShow();
	
	if(!AUTO_IDLE && ((last_presence == 'away') || (last_presence == 'xa')))
		return;
	
	var idle_presence;
	var activity_limit;
	
	// Can we extend to auto extended away mode (20 minutes)?
	if(AUTO_IDLE && (last_presence == 'away')) {
		idle_presence = 'xa';
		activity_limit = 1200;
	}
	
	// We must set the user to auto-away (10 minutes)
	else {
		idle_presence = 'away';
		activity_limit = 600;
	}
	
	// The user is really inactive and has set another presence than extended away
	if(((!AUTO_IDLE && (last_presence != 'away')) || (AUTO_IDLE && (last_presence == 'away'))) && (getLastActivity() >= activity_limit)) {
		// Then tell we use an auto presence
		AUTO_IDLE = true;
		
		// Get the old status message
		var status = getDB('options', 'presence-status');
		
		if(!status)
			status = '';
		
		// Change the presence input
		$('#my-infos .f-presence a.picker').attr('data-value', idle_presence);
		$('#presence-status').val(status);
		
		// Then send the xa presence
		presenceSend('', true);
		
		logThis('Auto-idle presence sent: ' + idle_presence, 3);
	}
}

// Restores the old presence on a document bind
function eventIdle() {
	// If we were idle, restore our old presence
	if(AUTO_IDLE) {
		// Get the values
		var show = getDB('presence-show', 1);
		var status = getDB('options', 'presence-status');
		
		// Change the presence input
		$('#my-infos .f-presence a.picker').attr('data-value', show);
		$('#presence-status').val(status);
		$('#presence-status').placeholder();
		
		// Then restore the old presence
		presenceSend('', true);
		
		if(!show)
			show = 'available';
		
		logThis('Presence restored: ' + show, 3);
	}
	
	// Apply some values
	AUTO_IDLE = false;
	LAST_ACTIVITY = getTimeStamp();
}

// Lives the auto idle functions
function liveIdle() {
	// Apply the autoIdle function every minute
	AUTO_IDLE = false;
	$('#my-infos .f-presence').everyTime('30s', autoIdle);
	
	// On body bind (click & key event)
	$('body').on('mousedown', eventIdle)
	         .on('mousemove', eventIdle)
	         .on('keydown', eventIdle);
}

// Kills the auto idle functions
function dieIdle() {
	// Remove the event detector
	$('body').off('mousedown', eventIdle)
	         .off('mousemove', eventIdle)
	         .off('keydown', eventIdle);
}

// Gets the user presence show
function getUserShow() {
	return $('#my-infos .f-presence a.picker').attr('data-value');
}

// Gets the user presence status
function getUserStatus() {
	return $('#presence-status').val();
}

// Plugin launcher
function launchPresence() {
	// Click event for user presence show
	$('#my-infos .f-presence a.picker').click(function() {
		// Disabled?
		if($(this).hasClass('disabled'))
			return false;
		
		// Initialize some vars
		var path = '#my-infos .f-presence div.bubble';
		var show_id = ['xa', 'away', 'available'];
		var show_lang = [_e("Not available"), _e("Away"), _e("Available")];
		var show_val = getUserShow();
		
		// Yet displayed?
		var can_append = true;
		
		if(exists(path))
			can_append = false;
		
		// Add this bubble!
		showBubble(path);
		
		if(!can_append)
			return false;
		
		// Generate the HTML code
		var html = '<div class="bubble removable">';
		
		for(i in show_id) {
			// Yet in use: no need to display it!
			if(show_id[i] == show_val)
				continue;
			
			html += '<a href="#" class="talk-images" data-value="' + show_id[i] + '" title="' + show_lang[i] + '"></a>';
		}
		
		html += '</div>';
		
		// Append the HTML code
		$('#my-infos .f-presence').append(html);
		
		// Click event
		$(path + ' a').click(function() {
			// Update the presence show marker
			$('#my-infos .f-presence a.picker').attr('data-value', $(this).attr('data-value'));
			
			// Close the bubble
			closeBubbles();
			
			// Focus on the status input
			$(document).oneTime(10, function() {
				$('#presence-status').focus();
			});
			
			return false;
		});
		
		return false;
	});
	
	// Submit events for user presence status
	$('#presence-status').placeholder()
	
	.keyup(function(e) {
		if(e.keyCode == 13) {
			$(this).blur();
			
			return false;
		}
	})
	
	.blur(function() {
		// Read the parameters
		var show = getUserShow();
		var status = getUserStatus();
		
		// Read the old parameters
		var old_show = getDB('presence-show', 1);
		var old_status = getDB('options', 'presence-status');
		
		// Must send the presence?
		if((show != old_show) || (status != old_status)) {
			// Update the local stored status
			setDB('options', 'presence-status', status);
			
			// Update the server stored status
			if(status != old_status)
				storeOptions();
			
			// Send the presence
			presenceSend();
		}
	})
	
	// Input focus handler
	.focus(function() {
		closeBubbles();
	});
}
