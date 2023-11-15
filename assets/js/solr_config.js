var config = {collectionId: "2r36tz25h", // Unique Id of the journal's collection in GWSS
			//Main query for free text searching --> Note that it references a variable called "user_query", which must be parametrized separately with the user's actual query string
			resultsFields: {title: "title_tesim",  	// GWSS fields to retrieve for search results, mapped to more descriptive names
					 authors: "creator_tesim",
					year: "date_created_tesim",
					volume: "identifier_tesim",
					doi: "doi_tesim"},
			freeTextQueryString: '{!lucene}_query_:"{!dismax v=$user_query}" _query_:"{!join from=id to=file_set_ids_ssim}{!dismax v=$user_query}"', 
			// Fields to search in on free text
			freeTextQueryFields: ["title_tesim", 
								"description_tesim", 
								"keyword_tesim", 
								"subject_tesim", 
								"creator_tesim", 
								"contributor_tesim", 
								"publisher_tesim", 
								"based_near_tesim", 
								"language_tesim", 
								"date_uploaded_tesim", 
								"date_modified_tesim", 
								"date_created_tesim", 
								"rights_statement_tesim", 
								"license_tesim", 
								"resource_type_tesim", 
								"format_tesim", 
								"identifier_tesim", 
								"gw_affiliation_tesim", 
								"degree_tesim", 
								"advisor_tesim", 
								"committee_member_tesim", 
								"bibliographic_citation_tesim", 
								"file_format_tesim", 
								"all_text_timv"],
			// Contains multiple filter queries for free text searching
			freeTextFilterQuery: ["({!terms f=edit_access_group_ssim}public) OR ({!terms f=discover_access_group_ssim}public) OR ({!terms f=read_access_group_ssim}public)",
							"{!terms f=has_model_ssim}GwWork,GwEtd,Collection",
							"({!terms f=edit_access_group_ssim}public) OR ({!terms f=discover_access_group_ssim}public) OR ({!terms f=read_access_group_ssim}public)",
							"-suppressed_bsi:true"],
			// For retrieving keyword metadata
			keywordField: "keyword_sim",
			collectionField: "member_of_collection_ids_ssim",
			solrURL: "http://ec2-18-222-180-6.us-east-2.compute.amazonaws.com/solr/solr-core-dev/select/"};
config.freeTextQueryFieldString = config.freeTextQueryFields.join(" ");
// For limiting to a particular GWSS collection
config.collectionFieldString = config.collectionField + ":" + config.collectionId;
config.freeTextFilterQuery.push(config.collectionFieldString);