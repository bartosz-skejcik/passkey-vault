//
//  InviteService.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-06, Task 2.
//  RED stub (TDD) -- InviteTests.swift's Task 2 suite is written against
//  this signature and must fail before the real implementation lands.
//

import Foundation

enum InviteServiceError: Error, CustomStringConvertible {
    case redStub

    var description: String { "InviteService is a RED stub (plan 40-06, Task 2)" }
}

struct InviteService {
    let baseURL: URL
    let tokenProvider: () -> String?
    var session: URLSession = .shared

    func generateInviteLink(userKey: FfiUserKey, expiresIn: String) async throws -> URL {
        throw InviteServiceError.redStub
    }
}
