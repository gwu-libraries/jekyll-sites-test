/* This script is responsible for querying the GWSS Solr index and returning results. */

// Maximum number to return per page of results
const maxRows = 5;

//DOI pattern --> used to identify filenames, capturing the part after the domain 
const doi_pattern = /https:\/\/doi\.org\/(\d+\.\d+\/\w+\.\w+\.\w+)/;

function makeFieldList() {
	// Makes a string for the field list (fl) parameter out of an object in the config.js file
	// Uses Object.keys for compatibility with older browsers
	let fieldList = Object.keys(config.resultsFields)
				.map(function (k) {
					return config.resultsFields[k];
				})
				.join(",");
	return encodeURI(fieldList);
}

function setSolrParams (freeText, keyword, currentPage) {
	// Maintains the parameter object for Solr queries on either keyword (in browse) or free text searching. Either freeText or keyword should be null, not both.
		// These parameters are the same for every search
		// The json.wrf parameter requires a callback
		// Since we're using the JQuery deferred instead, we can pass the question mark, forcing JQuery to supply an arbitrary one
		// An alternative (to JSONP) is to use a CORS request, but that would need to be configured on the server side
		// Solr pagination is zero-indexed; convert the page number passed by the site
		currentPage = parseInt(currentPage) - 1;

		let baseParams = {fl: makeFieldList(),
						start: currentPage * maxRows, // For getting the next page of results
						rows: maxRows,
						wt: "json",
						"json.wrf": "?"};
		// Parameters for a free text search
		if (freeText) {
			baseParams.user_query = freeText;
			baseParams.q = config.freeTextQueryString;
			baseParams.qf = config.freeTextQueryFieldString;
			baseParams.fq = config.freeTextFilterQuery;
		}
		else {
			let keywordFilterQueryString = config.keywordField + ":" + JSON.stringify(keyword) + " AND " + config.collectionFieldString;
			baseParams.q = "*"; 
			baseParams.fq = "(" + keywordFilterQueryString + ")";
		}
		return $.param(baseParams, true); // use "traditional" parametrization for the jQuery AJAX call -- supports converting an array of values into multiple instances of the same key-value pair
			
		
}

//For keyword browse, uses Solr's JSON Facet API in order to return the unique results from the keyword_sim field
const keywordFacetObject = {keywords: {
						type: "terms",
						sort: "index",
						field: config.keywordField,
						limit: -1 // To disable the limit altogether
						}
					};

const keywordFacetString = JSON.stringify(keywordFacetObject);	
// Use this parameters object for getting the list of keywords for browse
const keywordQueryParams = {data: {
								q: "*",
								fq: config.collectionField + ":" + config.collectionId,
								facet: "on",
								"json.facet": keywordFacetString,
								rows: 100,
								wt: "json",
								"json.wrf": "?"
								},
							dataType: "jsonp",
							jsonp: "json.wrf",
						};

function getKeywords() {
	// Function to retrieve the unique keywords associated with articles in the journal.
	$.ajax(config.solrURL, 
			keywordQueryParams)
	.done(function(data) {
		keywordArray = parseFacetResponse(data);
		populateKeywords(keywordArray);
	})
	.fail(function (jqXHR) {
		console.log(jqXHR);
	});

}

function parseFacetResponse(solrObj) {
	// Function to unpack the faceted response object returned by Solr. Returns an array of objects, each of which has a key of "keyword" and a value of the actual keyword.
	
	let facets = solrObj.facets;
	return facets.keywords.buckets.reduce(function(prev, curr) {
		let keywordObj = {keyword: curr.val.trim()}; // trim any leading or trailing spaces from the keywords
		prev.push(keywordObj);
		return prev;
	}, []);
}

function populateKeywords(data) {
	// Using jQuery, populates a list of divs, each holding a keyword, within a parent div
	$("#keywords-panel")
		.append(data.map(function(d) {
							let keywordDiv = $("<div/>").append("<a/>")
														.addClass("keywordList")
														.data(d);
							keywordDiv.children()
										.text(d.keyword) // + " (" + d.documents.length + ")")
										.addClass("keywordText")
										.attr("href", "#")
										.on("click", newKeywordSearch);
							return keywordDiv;
	}));
}

function newKeywordSearch(e) {
	// Queries the GWSS Solr index for articles matching the selected keyword
	
	e.preventDefault();
	let searchParams = {keyword: $(e.target).parent().data().keyword,
						currentPage: 0};
	doSolrSearch(searchParams);
	
}

function newFreeTextSearch() {
	// Gets the query string passed to the /search/ endpoint from our search form.
	let query = window.location.search.substring(1),
		searchStrings = query.split('&');
	// TO DO: Handle case of a null query
	// Unpack the query string and page number into a JS object
	let searchComponents = searchStrings.filter(function (s) {
		return (s[0] == 'q') || (s.slice(0, 4) == 'page');
	})
	searchComponents = searchComponents.reduce(function (prev, curr) {
		let variables = curr.split('=');
		// Decode a URL-encoded search string
		prev[variables[0]] = decodeURIComponent(variables[1].replace(/\+/g, "%20"));
		return prev;
	}, {});
	// Populate the search box with the current search
	$("input#issue-menu-input").val(searchComponents.q);
	// Execute the search
	doSolrSearch(searchComponents);	
}

function doSolrSearch(searchParams) {
	// Constructs a Solr query, using the passed parameters. Query may be either on a keyword or free text.
	let solrParams;
	// Case 1: Free text search
	if (!searchParams.keyword)  {
		// global object that keeps track of current search parameters
		// For free-text search 
		solrParams = setSolrParams(searchParams.q, 
										null, 
										searchParams.page);
		//console.log(solrParams)
	}
	// Case 2: keyword search
	else {
		solrParams = setSolrParams(null, 
									searchParams.keyword,
									searchParams.page);
	}
	$.ajax(config.solrURL, 
		{data: solrParams,
		dataType: "jsonp",
		jsonp: "json.wrf"
		}
	).done(function(data) {
		parseQueryResponse(data, searchParams); // Pass the search parameters along with the data for pagination purposes
	}).fail(function (jqXHR) {
		console.log(jqXHR);
	});
}

function parseQueryResponse(solrObj, searchParams) {
	// Unpacks the article metadata sent by a query when the user selects a keyword, performs a keyword search, or pages to another set of results.
	// Arguments: offset is an optional parameter for pagination through results  
	
	function unpackSolrDocs(prev, curr) {
			// Reducer function to unpack the metadata returned for each Solr result. 
			// Arguments: prev should be an empty array.
			// Extracts Solr response elements, repackages them as a metadata object, and adds it to a list
			prev.push(Object.keys(config.resultsFields)
							// For each of the designated metadata fields, extract the value from the results object. Each field value is stored in an array.
							.reduce(function (obj, key) {
								let metadataFieldArray = curr[config.resultsFields[key]];
								//  Authors field can have more than one value 
								if (key == 'authors') {
									obj[key] = metadataFieldArray;	
								}
								else {
								 	obj[key] = metadataFieldArray[0];
								}
								return obj;
							}, {}));
			return prev;
		}

	let numResults = solrObj.response.numFound,
	// Get the number of the first results in this set (for paginated results)
		offset = solrObj.response.start,
		resultsArray = solrObj.response.docs.reduce(unpackSolrDocs, []);

	// Calculate how many results are left, based on the offset of this set 
	if (numResults > maxRows) {
		// Case when there are more results than we can display on the screen at one time
		searchParams.totalPages = Math.ceil(numResults / maxRows),
			searchParams.currentPage = Math.ceil(offset / maxRows) + 1; // Add one because Solr offsets are 0-indexed
		showPagination(searchParams);
	}
	/*else {
		// Need to hide pagination elements
		hidePagination();
	}*/
	showArticles(resultsArray);
	
}

function hidePagination() {
	// Hide the pagination elements
	$("div#pages-panel").css("visibility", "hidden");
}

function showPagination(searchParams) {
	// Handles pagination links for each page of results
	// Encoding the query as part of the URL for each page of results	
	let href = "/search.html?q=" + encodeURIComponent(searchParams.q).replace(/%20/g, '+');
	// For screen readers
	let $hiddenText = $("<span/>")
							.addClass("visually-hidden")
							.text("Page: ");
	function createPageLink(offset, _, i) {
		// Add the Bootstrap elements to an array
		// encode the query string
		// add the page parameter
		let pageNum = i + offset;
		let	$listItem = $("<li/>").addClass("page-item"),
			$pageLink = $("<a/>").addClass("page-link")
								.attr("href", href + "&page="+ pageNum)
								.text(pageNum); // text of the link is the page number -- offset is 1 when creating a new list, otherwise the number at which to begin numbering
		$listItem.append([$hiddenText.clone(), $pageLink]);
		return $listItem;
	}

	function createPageElements(numPages, nextPage) {
		// Creates the  navigation links if they don't exist as an unordered list
		// If nextPage is undefined, it should be 1 -- creating a new list
		let createLinkFromOffset = (!nextPage) ? createPageLink.bind(undefined, 1) : createPageLink.bind(undefined, nextPage);		
		// Array of undefined of desired length (substitute for range() function)
		let pagesArray = Array.apply(null, Array(numPages));
		// Make an array to hold each page element
		let listElements = pagesArray.map(createLinkFromOffset);
		return listElements;
	}

	function addPrevNextLinks($nav) {
		let prevPage = searchParams.currentPage - 1,
			nextPage = searchParams.currentPage + 1;
		let $hiddenText = $("<span/>")
							.addClass("visually-hidden")
							.text(" page");
		let $prevItem = $("<li/>")
						.addClass("page-item"),
			$prevItemLink = $("<a/>").addClass("page-link")
							.attr("href", (prevPage < 1) ? "#" : href + "&page="+ prevPage)
							.text("Previous");
		$prevItem.append([$prevItemLink, $hiddenText]);
		$("li:first", $nav).before($prevItem);

		let $nextItem = $("<li/>")
						.addClass("page-item"),
			$nextItemLink = $("<a/>").addClass("page-link")
							.attr("href", (nextPage > searchParams.totalPages) ? "#" : href + "&page=" + nextPage)
							.text("Next");
		$nextItem.append([$nextItemLink, $hiddenText.clone()]);
		$("li:last", $nav).after($nextItem);
	}

	let $pagesPanel = $("div#pagination"); // select the container for the pagination
	/* If the panel currently has a navigation element, we can reuse it
	// Exclude the previous/next elements
	let $navLinks = $("nav > ul > li", $pagesPanel).not(":first").not(":last");
	// Case 1: Need to prune the number of page links
	if ($navLinks.length > searchParams.totalPages) {

		// filter those elements that are greater than the current number of pages and remove them
		$navLinks.filter(function(i) {
			// elements are zero-indexed
			return i >= searchParams.totalPages;
		}).remove();
	} 
	// Case 2: Need to add more pages
	else if (($navLinks.length > 0) && ($navLinks.length < searchParams.totalPages)) {

		let numPages = searchParams.totalPages - $navLinks.length,
			// the number of the next page to add after the existing page numbers
			nextPage = $navLinks.length + 1;
		// Create elements at the end of the existing links
		$navLinks.slice(-1).after(createPageElements(numPages, nextPage))
	}
	*/ 
	//else if ($navLinks.length == 0) {

	 // Top-level nav element
	let $navList = $("<nav/>");
	$navList.attr("aria-label", "Search results pages"); // Aria label for screen readers
	// Unordered list, Bootstrap-styled
	let $uList = $("<ul/>").addClass("pagination");
	// Add the list elements
	$uList.append(createPageElements(searchParams.totalPages));
	// Add to the nav element
	$navList.append($uList);
	// Add to the div
	$pagesPanel.append($navList);
	// Add the previous and next elements
	addPrevNextLinks($navList);		
	
	// Set the current page to active
	$(".page-item").not(":first").not(":last").each(function (i) {
		if (i == searchParams.currentPage - 1) {
			$(this).addClass("active");
			$(this).find("span").text("Current page: ");
		}
		else {
			$(this).removeClass("active");
			$(this).find("span").text("Page: ")
		}
	});
	// Disable next/previous buttons if necessary
	if (searchParams.currentPage == 1) {
		$(".page-item:first").addClass("disabled");
		$(".page-item:last").removeClass("disabled");
	}
	else if (searchParams.currentPage == searchParams.totalPages) {
		$(".page-item:first").removeClass("disabled");
		$(".page-item:last").addClass("disabled");
	}
	else {
		$(".page-item").removeClass("disabled");
	}

	/* Reset all the event handlers, leveraging closure over the function's keyword argument 
	$("nav", $pagesPanel).off("click").on("click", "a", function(e) {
			e.preventDefault()
			// If the Previous link is clicked, go to the previous page
			if (e.currentTarget.innerText == "Previous" ) {
				searchParams.currentPage -= 2; 
				doSolrSearch(searchParams);
			}
			// If the Next link is clicked, go to the next page
			else if (e.currentTarget.innerText == "Next") {
				doSolrSearch(searchParams);
			}
			// Otherwise, go to the page number associated with that link
			else {
				// Offset to be passed to the Solr search is zero indexed
				searchParams.currentPage = +e.currentTarget.innerText - 1;
				doSolrSearch(searchParams); 
			}
	});
	// Make sure the pagination parent is visible
	$("div#pages-panel").css("visibility", "visible");*/
}


function parseAuthorNames(author) {
	// Takes a comma-separated name of the form lastname, firstname and returns it in the form firstname <space> lastname
	let authorName = author.split(",");
	if (authorName.length > 1) {
		// First name <space> Last name
		authorName = authorName[1] + " " + authorName[0]
	}
	// In case of a corporate author
	else {
		authorName = authorName[0];
	}
	return authorName;
}

function showArticles(resultsMetadata) {
	// For null results
	if (resultsMetadata.length == 0) {
		let $resultsPanel = $("#search-results"),
			$noResultsMessage = $("<p/>").addClass("no-results").text("No results found for that search term. Please try again.");
		$resultsPanel.append($noResultsMessage);
		return;

	}

	// Displays the article-level results returned by a keyword search. 
	let $resultsPanel = $("#search-results");
	/* remove any previous results
	$(".article-list").remove();*/
	// Create the list of results as an unordered ist
	$articleList = $("<ul/>").addClass("article-list");
	$resultsPanel.append($articleList);
	// Add the list elements
	$articleList.append(resultsMetadata.map(function(d) {
		// get links to each article's HTML and PDF
		let links = makeLinksToArticle(d);

		let $article = $("<li/>").addClass("article-list-element"),
			// link to the PDF of the article
			$articlePDFDiv = $("<div/>").addClass("toc-pdf");
			$articlePDF = $("<p/>").addClass("toc-pdf"),
			$pdfLink = $("<a/>").addClass("toc-pdf-link"),
			// the text of the title is an <a> tag whose parent is a <p> tag 
			$articlePDiv = $("<div/>").addClass("toc-title");
			$articleP = $("<p/>").addClass("toc-title"),
			$articleLink = $("<a/>").addClass("toc-title-link");
			// Add the link to the PDF and the aria text
			$pdfLink.attr("href", links.pdf);
			$pdfLink.attr("aria-label", "Download PDF of " + d.title);
			// Add the PDF icon
			let $pdfIcon = $("<i/>").addClass("far fa-file-pdf");
			$pdfLink.append($pdfIcon)
			$pdfLink.append("<span> PDF</span>");
			// Add the link and text to the title <a>
			$articleLink.attr("href", links.html).text(d.title);
			$articleLink.attr("aria-label", "Open abstract page of " + d.title);
			// Set the text for the volume element
			let $articleVolume = $("<span/>").addClass("toc-volume")
									.text(d.volume),
				// Join authors with commas
				articleAuthors = d.authors.map(parseAuthorNames)
										.join(", "), 
				$articleAuthors = $("<span/>")
						.addClass("toc-authors") 
						.text(articleAuthors);
		// append the children to the <p> and the <p> to the <li>
		$articleP.append([$articleLink, $("<br>"), $articleAuthors, $("<br>"), $articleVolume]);
		$articlePDiv.append($articleP);
		$articlePDF.append($pdfLink);
		$articlePDFDiv.append($articlePDF);
		$article.append([$articlePDiv, $articlePDFDiv]);

		return $article;
	}));



}

function makeLinksToArticle(articleMetadata) {
	// Create a link to the article page, using the metadata from GWSSS
	let volIssue = articleMetadata.volume.split(" "),
		issuePath;
	// Case one: there's only a volume number
	if (volIssue.length == 2) {
		issuePath = volIssue.join("_").toLowerCase();
	}
	// Case two: volume and issue number -- combine the elements, minues the hyphen
	else {
		issuePath = volIssue.slice(0, 2).concat(volIssue.slice(3, 5)).join("_").toLowerCase();
	}
	// Create the article path from the DOI
	let articlePath = articleMetadata.doi.match(doi_pattern),
		linkToArticle = "#",
		linkToPDF = "#";
	// The capture group should be the second element in the match array
	try {
		articlePath = articlePath[1].replace(/\.|\//g, "_"); // Replace periods with underscores
		// Create the whole path
		linkToArticle = "/articles/" + issuePath + "/" + articlePath + ".html";
		linkToPDF = "/articles/" + issuePath + "/" + articlePath + ".pdf";
	} 
	catch (e) {
		console.log(e);
		console.log(articleMetadata.doi);
	}

	return {html: linkToArticle,
			pdf: linkToPDF};
}
$(document).ready(function () {
	newFreeTextSearch();
	//getKeywords(); // Don't need keyword browse for GBL
});
