import Foundation

/// Realbooru list scraper. Mirrors RN `fetchRealbooruPosts` (booruApi.ts:1032-1206) and the tag autocomplete (booruApi.ts:2412-2435).
struct RealbooruSource: BooruSource {
    let id: SourceID = .realbooru
    let displayName = "Realbooru"
    let supportsVideo = true

    /// RN realbooru base URL (sources.ts:31).
    static let baseURL = "https://realbooru.com"
    /// RN User-Agent constant (booruApi.ts:58).
    static let userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
    /// RN lists 42 posts per page (booruApi.ts:1040-1041).
    static let pageSize = 42

    /// Named regex constants for the Realbooru markup.
    private enum Pattern {
        /// Card start: `<div class="... thumb ..." id="s<digits>">` (booruApi.ts:1065).
        static let cardStart = #"<div\s+class=["'][^"']*thumb[^"']*["']\s+id=["']s?(\d+)["']>"#
        /// Thumbnail path `thumbnails/<dir>/<dir>/thumbnail_<hash>.` shared with the full file (booruApi.ts:1094).
        static let thumbnailPath = #"thumbnails/([a-f0-9]+)/([a-f0-9]+)/thumbnail_([a-f0-9]+)\."#
        /// Score token inside the title, such as `score:17` (booruApi.ts:1086).
        static let scoreToken = #"score:(\d+)"#
        /// Score tokens removed before the title is split into tags (booruApi.ts:1100).
        static let scoreRemoval = #"score:\d+"#
        /// Rating tokens removed before the title is split into tags (booruApi.ts:1100).
        static let ratingRemoval = #"rating:\w+"#
        /// File URL in a data attribute, such as `data-file="..."` (booruApi.ts:1129).
        static let dataURLAttribute = #"data-(?:file|src|original|original-url|media)=["']([^"']+)["']"#
        /// Extension in a data attribute, such as `data-ext="webm"` (booruApi.ts:1141).
        static let dataExtAttribute = #"data-ext=["']([a-z0-9]+)["']"#
        /// Count in an autocomplete label, such as `(12)` (booruApi.ts:2426).
        static let countInLabel = #"\((\d+)\)"#
    }

    func fetchPosts(query: SearchQuery, page: Int, context: SourceContext) async throws -> PostPage {
        let pageNumber = max(1, page)
        guard let url = Self.listURL(page: pageNumber, tags: Self.searchTags(for: query)) else {
            throw BooruError.network("Invalid Realbooru list URL.")
        }
        let request = HTMLScanner.htmlRequest(url, userAgent: Self.userAgent, referer: Self.baseURL + "/")
        let html = try await HTMLScanner.fetchHTML(request, client: context.http)
        let posts = Self.parseListing(html: html)
        return PostPage(posts: posts, nextPage: posts.isEmpty ? nil : pageNumber + 1, hasMore: !posts.isEmpty)
    }

    func tagSuggestions(prefix: String, context: SourceContext) async throws -> [BooruTagSuggestion] {
        // RN ignores queries shorter than two characters (booruApi.ts:2291).
        let term = HTMLScanner.trim(prefix)
        guard term.count >= 2,
              let url = URL(string: "\(Self.baseURL)/autocomplete.php?q=\(HTMLScanner.componentEncode(term))")
        else { return [] }
        var request = HTMLScanner.htmlRequest(url, userAgent: Self.userAgent, referer: Self.baseURL + "/")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await context.http.data(for: request)
            guard (200..<300).contains(response.statusCode),
                  let items = try JSONSerialization.jsonObject(with: data) as? [[String: Any]]
            else { return [] }
            return items.prefix(12).compactMap { (item: [String: Any]) -> BooruTagSuggestion? in
                let value = item["value"] as? String
                let label = item["label"] as? String
                let name = value ?? label ?? ""
                guard !name.isEmpty else { return nil }
                let count = label.flatMap { HTMLScanner.firstCapture(Pattern.countInLabel, in: $0) }.flatMap { Int($0) } ?? 0
                return BooruTagSuggestion(name: name, category: .general, postCount: count)
            }
        } catch let error as CancellationError {
            throw error
        } catch {
            // RN returns an empty list on any autocomplete failure (booruApi.ts:2523-2525).
            return []
        }
    }

    func resolveMedia(for post: BooruPost, context: SourceContext) async throws -> ResolvedMedia {
        let video = VideoCandidateSelector.videoCandidates(for: post).first
        return ResolvedMedia(
            imageURL: ImageQualityResolver.imageURL(for: post, quality: context.imageQuality),
            videoURL: video,
            isVideo: video != nil,
            placeholderURL: ImageQualityResolver.placeholderURL(for: post)
        )
    }

    // MARK: - URLs and tags

    /// List URL for one page: `index.php?page=post&s=list&pid=<(page-1)*42>[&tags=...]` (booruApi.ts:1039-1051).
    static func listURL(page: Int, tags: String) -> URL? {
        let pid = (max(1, page) - 1) * pageSize
        var parameters: [(String, String)] = [("page", "post"), ("s", "list"), ("pid", String(pid))]
        if !tags.isEmpty {
            parameters.append(("tags", tags))
        }
        let query = parameters
            .map { HTMLScanner.formEncode($0.0) + "=" + HTMLScanner.formEncode($0.1) }
            .joined(separator: "&")
        return URL(string: baseURL + "/index.php?" + query)
    }

    /// The `tags` value: query text, filter tags, then the Gelbooru-engine tokens RN adds in order:
    /// score, user, leaderboard date, rating, sort (booruApi.ts:248-383).
    static func searchTags(for query: SearchQuery) -> String {
        let filter = query.filter
        var derived: [String] = []
        if let minScore = filter.minScore, minScore > 0 {
            derived.append("score:>=\(minScore)")
        }
        if let user = filter.user.map({ HTMLScanner.trim($0) }), !user.isEmpty {
            derived.append("user:\(user)")
        }
        // Historical leaderboard anchor. Realbooru is not in RN's exclusion list, so the raw date is a literal `date:` tag (booruApi.ts:287-296).
        if let leaderboard = filter.leaderboardDate, !leaderboard.isEmpty {
            derived.append("date:\(leaderboard.booruTrimmed)")
        }
        switch filter.rating {
        case .all: break
        case .safe: derived.append("rating:safe")
        case .questionable: derived.append("rating:questionable")
        case .explicit: derived.append("rating:explicit")
        }
        // Gelbooru-engine sort tokens; the unsupported orders send nothing (booruApi.ts:316-380).
        switch filter.sortBy {
        case .score: derived.append("sort:score:desc")
        case .id: derived.append("sort:id:desc")
        case .height: derived.append("sort:height:desc")
        case .width: derived.append("sort:width:desc")
        default: break
        }
        return HTMLScanner.searchTokens(for: query, extra: derived).joined(separator: " ")
    }

    // MARK: - Parsing

    /// Parses one list page. A card without a link, an image, or a numeric id is skipped (booruApi.ts:1065-1203).
    static func parseListing(html: String) -> [BooruPost] {
        let createdAt = HTMLScanner.isoTimestamp()
        var posts: [BooruPost] = []
        for section in HTMLScanner.sections(Pattern.cardStart, in: html, caseInsensitive: true) {
            guard section.captures.count > 1 else { continue }
            guard let post = parseCard(id: section.captures[1], body: section.body, createdAt: createdAt) else { continue }
            posts.append(post)
        }
        return posts
    }

    private static func parseCard(id: String, body: String, createdAt: String) -> BooruPost? {
        guard let anchor = HTMLScanner.firstTag("a", in: body),
              let href = HTMLScanner.attribute("href", in: anchor),
              let image = HTMLScanner.firstTag("img", in: body),
              let rawThumb = HTMLScanner.attribute("src", in: image),
              let previewURL = HTMLScanner.absoluteURL(rawThumb, base: baseURL)
        else { return nil }

        let alt = HTMLScanner.attribute("alt", in: image) ?? ""
        let title = HTMLScanner.attribute("title", in: image) ?? ""
        let rating = ratingFromTitle(title)
        let score = HTMLScanner.firstCapture(Pattern.scoreToken, in: title).flatMap { Int($0) } ?? 0
        let rawTags = tagsFromCard(title: title, alt: alt)
        let lowerTags = rawTags.map { $0.lowercased() }

        // GIFs are tagged `animated` + `gif` with no `video` tag; they must not reach the video player (booruApi.ts:1106-1110).
        let hasGifTag = lowerTags.contains("gif")
        let hasVideoTag = lowerTags.contains { ["video", "webm", "mp4"].contains($0) }
        let isGif = hasGifTag && !hasVideoTag
        let thumbString = previewURL.absoluteString
        let hasVideoHint = lowerTags.contains { ["video", "webm", "mp4", "sound", "animated"].contains($0) }
        let isVideo = !isGif && (thumbString.hasSuffix(".mp4") || thumbString.hasSuffix(".webm") || hasVideoHint)

        // A verified file URL in the link, a data attribute, or a data-ext attribute sets the extension (booruApi.ts:1118-1145).
        var verifiedExt: String?
        var verifiedOriginal: URL?
        if let ext = HTMLScanner.mediaExtension(in: href) {
            verifiedExt = ext
            verifiedOriginal = HTMLScanner.absoluteURL(href, base: baseURL)
        }
        if verifiedExt == nil,
           let dataURL = HTMLScanner.firstCapture(Pattern.dataURLAttribute, in: body, caseInsensitive: true),
           let ext = HTMLScanner.mediaExtension(in: HTMLScanner.trim(HTMLScanner.decodeEntities(dataURL))) {
            verifiedExt = ext
            verifiedOriginal = HTMLScanner.absoluteURL(HTMLScanner.decodeEntities(dataURL), base: baseURL)
        }
        if verifiedExt == nil,
           let dataExt = HTMLScanner.firstCapture(Pattern.dataExtAttribute, in: body, caseInsensitive: true) {
            let lower = dataExt.lowercased()
            verifiedExt = lower == "jpeg" ? "jpg" : lower
        }
        let fileExt = verifiedExt ?? (isGif ? "gif" : (isVideo ? "mp4" : "jpg"))

        // The full GIF is tens of MB, so a GIF keeps the light thumbnail as its sample (booruApi.ts:1155-1161).
        var sampleURL: URL? = previewURL
        var originalURL: URL?
        if let verifiedOriginal {
            originalURL = verifiedOriginal
            sampleURL = verifiedOriginal
        } else if isVideo || isGif,
                  let parts = HTMLScanner.captures(Pattern.thumbnailPath, in: thumbString, caseInsensitive: true),
                  parts.count > 3 {
            let file = "\(baseURL)/images/\(parts[1])/\(parts[2])/\(parts[3]).\(isGif ? "gif" : "mp4")"
            originalURL = URL(string: file)
            sampleURL = isGif ? previewURL : originalURL
        }

        let sourceLink: URL?
        if href.contains("page=post") {
            sourceLink = HTMLScanner.absoluteURL(href, base: baseURL)
        } else {
            sourceLink = URL(string: "\(baseURL)/index.php?page=post&s=view&id=\(id)")
        }

        return BooruPost(
            id: "realbooru_\(id)",
            sourceID: .realbooru,
            sourceName: "Realbooru",
            title: nil,
            previewURL: previewURL,
            previewFallbackURL: nil,
            previewVideoURL: nil,
            previewThumbURL: nil,
            previewThumbs: nil,
            sampleURL: sampleURL,
            originalURL: originalURL,
            width: 800,
            height: 1000,
            aspectRatio: 0.8,
            rating: rating,
            score: score,
            favCount: 0,
            tags: BooruTagGroups(
                artist: [],
                character: [],
                copyright: [],
                general: rawTags,
                meta: isVideo ? ["video"] : []
            ),
            allTags: rawTags,
            sourceLink: sourceLink,
            fileExt: fileExt,
            fileSize: nil,
            createdAt: createdAt,
            niches: nil,
            isPremium: nil,
            pageCount: nil,
            mediaId: nil
        )
    }

    /// Rating from the title tokens (booruApi.ts:1081-1083). The default is safe.
    private static func ratingFromTitle(_ title: String) -> PostRating {
        if title.contains("rating:questionable") || title.contains("rating:q") { return .questionable }
        if title.contains("rating:explicit") || title.contains("rating:e") { return .explicit }
        return .safe
    }

    /// Tags come from the title when present, otherwise from alt (booruApi.ts:1097-1103). Score and rating tokens are removed first.
    private static func tagsFromCard(title: String, alt: String) -> [String] {
        let source: String
        if title.isEmpty {
            source = alt
        } else {
            let withoutScore = HTMLScanner.replace(Pattern.scoreRemoval, in: title, with: "")
            source = HTMLScanner.replace(Pattern.ratingRemoval, in: withoutScore, with: "")
        }
        let separators = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ","))
        let pieces = source.components(separatedBy: separators).filter { !$0.isEmpty }
        return HTMLScanner.uniqued(pieces)
    }
}
